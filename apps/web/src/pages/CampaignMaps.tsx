import {
  CELL_METERS,
  cellsBetween,
  insideGrid,
  type Cell,
  type Terrain,
} from '@dungeon-copilot/rules';
import {
  MAP_IMAGE_LIMITS,
  MAP_IMAGE_MAX_TEXT,
  MAP_IMAGE_TYPES,
  MAP_LIMITS,
  type MapBackground,
  type MapGrid,
  type MapView,
} from '@dungeon-copilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { Icon } from '../components/Icon';
import {
  CELL,
  MAP_SCALE,
  MapLegend,
  MapTerrain,
  MapThumb,
  TERRAIN_HINTS,
  cellKey,
  pointerCell,
} from '../components/MapGrid';
import {
  ConfirmButton,
  ErrorNote,
  PageMessage,
  QueryState,
  Segmented,
  useDocumentTitle,
} from '../components/ui';
import { keys, useMap, useMaps, useStoreMap } from '../queries';
import { useCampaignOutlet } from './CampaignPage';

const meters = (cells: number) => (cells * CELL_METERS).toLocaleString('es-ES');

/** «20 × 14 casillas (30 × 21 m)». */
const sizeText = ({ cols, rows }: Pick<MapGrid, 'cols' | 'rows'>) =>
  `${cols} × ${rows} casillas (${meters(cols)} × ${meters(rows)} m)`;

const NOT_YOURS = (
  <PageMessage title="Los mapas son cosa del máster">
    <p className="muted">Los verás en la partida, cuando ponga uno en la mesa.</p>
  </PageMessage>
);

/**
 * Los mapas de la campaña: planos en casillas para los combates. Solo los ve el máster, que los
 * pone en la partida desde la sala. Cada uno se edita en su página (`mapas/:mapId`).
 */
export function CampaignMaps() {
  const { campaign } = useCampaignOutlet();
  const isMaster = campaign.role === 'master';
  const maps = useMaps(campaign.id, isMaster);
  const [creating, setCreating] = useState(false);
  if (!isMaster) return NOT_YOURS;

  return (
    <section className="stack" aria-labelledby="maps-heading">
      <div className="section-head">
        <h2 id="maps-heading" className="visually-hidden">
          Mapas
        </h2>
        <p className="muted">
          Planos en casillas de {meters(1)} m para los combates. Solo los ves tú hasta que pones uno
          en la partida.
        </p>
        {!creating && (
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            Nuevo mapa
          </button>
        )}
      </div>
      {creating && <NewMap campaignId={campaign.id} onCancel={() => setCreating(false)} />}
      {maps.data ? (
        maps.data.length > 0 ? (
          <ul className="map-grid">
            {maps.data.map((map) => (
              <li key={map.id}>
                <Link to={`/campanas/${campaign.id}/mapas/${map.id}`} className="map-card">
                  <MapThumb grid={map.grid} />
                  <strong>{map.name}</strong>
                  <span className="muted">{sizeText(map.grid)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          !creating && (
            <div className="panel empty">
              <p>Aún no hay mapas.</p>
              <p className="muted">
                Dibuja la posada, la cripta o el camino donde vaya a haber pelea.
              </p>
            </div>
          )
        )
      ) : (
        <QueryState error={maps.error} />
      )}
    </section>
  );
}

/** El ancho o el alto de un mapa, en casillas: se escribe y se ajusta a los topes al salir. */
function SideInput(props: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(props.value));
  const commit = () => {
    const value = Number.parseInt(text, 10);
    const side = Number.isNaN(value)
      ? props.value
      : Math.min(MAP_LIMITS.maxSide, Math.max(MAP_LIMITS.minSide, value));
    setText(String(side));
    if (side !== props.value) props.onChange(side);
  };
  return (
    <label className="field side-field">
      <span className="field-label">{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={MAP_LIMITS.minSide}
        max={MAP_LIMITS.maxSide}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

/** Un número con decimales que cambia el mapa según se escribe (o con las flechas). */
function DecimalInput(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const { label, value, min, max, step, onChange } = props;
  const [text, setText] = useState(String(value));
  // Si cambia desde fuera (al subir otro plano), se ve el valor nuevo.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max) {
            setShown(next);
            onChange(next);
          }
        }}
      />
    </label>
  );
}

const round = (value: number) => Math.round(value * 100) / 100;

const clampSide = (value: number) =>
  Math.min(MAP_LIMITS.maxSide, Math.max(MAP_LIMITS.minSide, Math.ceil(value)));

/** El alto entre el ancho de una imagen, para estirarla sin deformarla. */
function imageRatio(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalHeight / image.naturalWidth);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se puede leer esa imagen'));
    };
    image.src = url;
  });
}

/**
 * El plano de fondo de un mapa: subir una imagen y ajustar la cuadrícula encima, diciendo cuántas
 * casillas mide a lo ancho y moviéndola hasta que sus líneas coincidan con las de la cuadrícula.
 */
function BackgroundPanel(props: {
  campaignId: string;
  background: MapBackground | null;
  cols: number;
  onChange: (background: MapBackground | null) => void;
  onFit: (size: { cols: number; rows: number }) => void;
}) {
  const { campaignId, background, cols, onChange, onFit } = props;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!(MAP_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        throw new Error('Sube una imagen PNG, JPEG o WebP');
      }
      if (file.size > MAP_IMAGE_LIMITS.bytes) {
        throw new Error(`El plano no puede pasar de ${MAP_IMAGE_MAX_TEXT}`);
      }
      const ratio = await imageRatio(file);
      const image = await api.uploadMapImage(campaignId, file);
      return { image, ratio };
    },
    // De entrada, a lo ancho del mapa y sin deformar; luego se ajusta.
    onSuccess: ({ image, ratio }) =>
      onChange({ image: image.id, x: 0, y: 0, width: cols, height: round(cols * ratio) }),
  });
  const ratio = background ? background.height / background.width : 1;

  return (
    <section className="panel map-background" aria-labelledby="background-heading">
      <h3 id="background-heading">Plano de fondo</h3>
      <p className="hint">
        Una imagen del lugar debajo de la cuadrícula: PNG, JPEG o WebP, hasta {MAP_IMAGE_MAX_TEXT}.
        Los muros, las ventanas y los muebles se pintan encima, porque son los que cuentan para la
        línea de visión y la cobertura.
      </p>
      <div className="actions">
        <label className="button small file-button">
          <input
            type="file"
            accept={MAP_IMAGE_TYPES.join(',')}
            className="visually-hidden"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Que se pueda volver a elegir la misma imagen.
              event.target.value = '';
              if (file) upload.mutate(file);
            }}
          />
          {upload.isPending ? 'Subiendo…' : background ? 'Cambiar el plano' : 'Subir un plano'}
        </label>
        {background && (
          <button type="button" className="link-button" onClick={() => onChange(null)}>
            Quitar el plano
          </button>
        )}
      </div>
      {background && (
        <>
          <div className="background-fields">
            <DecimalInput
              label="Casillas a lo ancho del plano"
              value={background.width}
              min={0.5}
              max={MAP_LIMITS.maxSide * 4}
              step={0.5}
              onChange={(width) => onChange({ ...background, width, height: round(width * ratio) })}
            />
            <DecimalInput
              label="Desde la izquierda"
              value={background.x}
              min={-MAP_LIMITS.maxSide}
              max={MAP_LIMITS.maxSide}
              step={0.1}
              onChange={(x) => onChange({ ...background, x })}
            />
            <DecimalInput
              label="Desde arriba"
              value={background.y}
              min={-MAP_LIMITS.maxSide}
              max={MAP_LIMITS.maxSide}
              step={0.1}
              onChange={(y) => onChange({ ...background, y })}
            />
          </div>
          <p className="hint">
            Si el plano trae su propia cuadrícula, cuenta sus casillas de un lado a otro y ponlas en
            el ancho; luego muévelo, en casillas, hasta que las líneas coincidan.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button small"
              onClick={() =>
                onFit({
                  cols: clampSide(background.x + background.width),
                  rows: clampSide(background.y + background.height),
                })
              }
            >
              Ajustar el mapa al plano
            </button>
          </div>
        </>
      )}
      <ErrorNote error={upload.error} />
    </section>
  );
}

function NewMap({ campaignId, onCancel }: { campaignId: string; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [cols, setCols] = useState(20);
  const [rows, setRows] = useState(14);
  const storeMap = useStoreMap();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.createMap(campaignId, { name, grid: { cols, rows } }),
    onSuccess: async (map) => {
      storeMap(map);
      await navigate(`/campanas/${campaignId}/mapas/${map.id}`);
    },
  });

  return (
    <form
      className="panel stack tight"
      aria-labelledby="new-map-heading"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h3 id="new-map-heading">Nuevo mapa</h3>
      <div className="map-size">
        <label className="field">
          <span className="field-label">Nombre</span>
          <input
            required
            autoFocus
            maxLength={MAP_LIMITS.name}
            placeholder="Posada del Ciervo Blanco"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <SideInput label="Ancho, en casillas" value={cols} onChange={setCols} />
        <SideInput label="Alto, en casillas" value={rows} onChange={setRows} />
      </div>
      <p className="hint">
        {sizeText({ cols, rows })}. Empieza vacío, todo suelo: después dibujas muros, puertas,
        ventanas y muebles.
      </p>
      <ErrorNote error={create.error} />
      <div className="actions">
        <button type="submit" className="button primary" disabled={create.isPending}>
          Crear y dibujar
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Un mapa de la campaña, en su editor. */
export function CampaignMapEditor() {
  const { mapId = '' } = useParams();
  const { campaign } = useCampaignOutlet();
  const map = useMap(campaign.role === 'master' ? mapId : '');
  useDocumentTitle(map.data ? `${map.data.name} · ${campaign.name}` : campaign.name);
  if (campaign.role !== 'master') return NOT_YOURS;
  if (!map.data) return <QueryState error={map.error} />;
  // Otro mapa empieza de cero; el mismo, guardado, sigue donde estaba.
  return <MapEditor key={map.data.id} map={map.data} />;
}

/** Con qué se pinta: algo del mapa o, al borrar, suelo. */
type Paint = Terrain | 'floor';
/** Cómo se pinta: casilla a casilla, un rectángulo lleno o solo su borde (una habitación). */
type Shape = 'brush' | 'rect' | 'room';

const PAINTS: [Paint, string][] = [
  ['wall', 'Muro'],
  ['door', 'Puerta'],
  ['window', 'Ventana'],
  ['cover', 'Mueble'],
  ['floor', 'Borrar'],
];

const SHAPES: [Shape, string][] = [
  ['brush', 'Pincel'],
  ['rect', 'Rectángulo'],
  ['room', 'Habitación'],
];

const PAINT_HINTS: Record<Paint, string> = {
  ...TERRAIN_HINTS,
  floor: 'vuelve a ser suelo',
};

type TerrainCells = ReadonlyMap<string, Terrain>;

const toCells = (grid: MapGrid): TerrainCells =>
  new Map(grid.terrain.map((tile) => [cellKey(tile), tile.kind]));

/** Lo pintado que cabe en el mapa, por filas: así se guarda y así se compara. */
function toTerrain(cells: TerrainCells, cols: number, rows: number): MapGrid['terrain'] {
  return [...cells]
    .map(([key, kind]) => {
      const [x = 0, y = 0] = key.split(',').map(Number);
      return { x, y, kind };
    })
    .filter((tile) => tile.x < cols && tile.y < rows)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Las casillas de un rectángulo entre dos esquinas; con `outline`, solo las del borde. */
function rectCells(a: Cell, b: Cell, outline: boolean): Cell[] {
  const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const cells: Cell[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!outline || x === left || x === right || y === top || y === bottom) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * El plano de fondo con sus campos siempre en el mismo orden: la base de datos los guarda en el
 * suyo, y así se compara lo guardado con lo que hay.
 */
const placed = (background: MapBackground | null | undefined): MapBackground | null =>
  background
    ? {
        image: background.image,
        x: background.x,
        y: background.y,
        width: background.width,
        height: background.height,
      }
    : null;

const clampCell = (cell: Cell, { cols, rows }: { cols: number; rows: number }): Cell => ({
  x: Math.min(cols - 1, Math.max(0, cell.x)),
  y: Math.min(rows - 1, Math.max(0, cell.y)),
});

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * El editor de un mapa: se pintan muros, puertas, ventanas y muebles casilla a casilla, en
 * rectángulos o como el borde de una habitación, arrastrando o con el teclado (flechas y
 * Espacio). Nada se guarda hasta «Guardar cambios».
 */
function MapEditor({ map }: { map: MapView }) {
  const [name, setName] = useState(map.name);
  const [size, setSize] = useState({ cols: map.grid.cols, rows: map.grid.rows });
  const [cells, setCells] = useState(() => toCells(map.grid));
  const [background, setBackground] = useState<MapBackground | null>(map.grid.background ?? null);
  const [history, setHistory] = useState<TerrainCells[]>([]);
  const [paint, setPaint] = useState<Paint>('wall');
  const [shape, setShape] = useState<Shape>('brush');
  const [stroke, setStroke] = useState<{ start: Cell; end: Cell } | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const storeMap = useStoreMap();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const grid: MapGrid = {
    ...size,
    terrain: toTerrain(cells, size.cols, size.rows),
    background: placed(background),
  };
  const saved: MapGrid = {
    cols: map.grid.cols,
    rows: map.grid.rows,
    terrain: toTerrain(toCells(map.grid), map.grid.cols, map.grid.rows),
    background: placed(map.grid.background),
  };
  const dirty = name.trim() !== map.name || JSON.stringify(grid) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: () => api.updateMap(map.id, { name, grid }),
    onSuccess: storeMap,
  });
  const destroy = useMutation({
    mutationFn: () => api.deleteMap(map.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.map(map.id) });
      await queryClient.invalidateQueries({ queryKey: keys.maps(map.campaignId) });
      await navigate(`/campanas/${map.campaignId}/mapas`);
    },
  });

  const remember = () => setHistory((past) => [...past.slice(-49), cells]);
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setCells(previous);
    setHistory(history.slice(0, -1));
  };
  const apply = (targets: readonly Cell[]) =>
    setCells((current) => {
      const next = new Map(current);
      for (const cell of targets) {
        if (!insideGrid(size, cell)) continue;
        if (paint === 'floor') next.delete(cellKey(cell));
        else next.set(cellKey(cell), paint);
      }
      return next;
    });

  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !svg.current) return;
    const cell = pointerCell(svg.current, event);
    if (!insideGrid(size, cell)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    remember();
    setCursor(cell);
    if (shape === 'brush') apply([cell]);
    setStroke({ start: cell, end: cell });
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!stroke || !svg.current) return;
    const cell = clampCell(pointerCell(svg.current, event), size);
    if (cell.x === stroke.end.x && cell.y === stroke.end.y) return;
    // El pincel pinta también las casillas por las que ha pasado entre un evento y otro.
    if (shape === 'brush') apply([...cellsBetween(stroke.end, cell), cell]);
    setStroke({ ...stroke, end: cell });
    setCursor(cell);
  }

  function up() {
    if (!stroke) return;
    if (shape !== 'brush') apply(rectCells(stroke.start, stroke.end, shape === 'room'));
    setStroke(null);
  }

  function key(event: KeyboardEvent<SVGSVGElement>) {
    const step = ARROWS[event.key];
    const at = cursor ?? { x: 0, y: 0 };
    if (step) {
      event.preventDefault();
      setCursor(clampCell({ x: at.x + step.x, y: at.y + step.y }, size));
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      remember();
      apply([at]);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
  }

  const preview =
    stroke && shape !== 'brush' ? rectCells(stroke.start, stroke.end, shape === 'room') : [];

  return (
    <section className="map-editor" aria-labelledby="map-editor-heading">
      <Link to={`/campanas/${map.campaignId}/mapas`} className="eyebrow back">
        ← Mapas
      </Link>
      <h2 id="map-editor-heading" className="visually-hidden">
        Editar el mapa {map.name}
      </h2>
      <form
        className="map-editor-head"
        aria-label="Nombre y tamaño"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="field">
          <span className="field-label">Nombre</span>
          <input
            required
            maxLength={MAP_LIMITS.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {/* Si el tamaño cambia desde fuera (al ajustarlo al plano), los campos empiezan de nuevo. */}
        <SideInput
          key={`cols-${size.cols}`}
          label="Ancho"
          value={size.cols}
          onChange={(cols) => setSize({ ...size, cols })}
        />
        <SideInput
          key={`rows-${size.rows}`}
          label="Alto"
          value={size.rows}
          onChange={(rows) => setSize({ ...size, rows })}
        />
        <div className="actions">
          <button type="button" className="button" disabled={history.length === 0} onClick={undo}>
            <Icon name="undo" size={18} />
            Deshacer
          </button>
          <button type="submit" className="button primary" disabled={!dirty || save.isPending}>
            {dirty ? 'Guardar cambios' : 'Guardado'}
          </button>
        </div>
      </form>
      <ErrorNote error={save.error} />

      <div className="map-toolbar">
        <Segmented label="Pintar" value={paint} options={PAINTS} onChange={setPaint} />
        <Segmented label="Forma" value={shape} options={SHAPES} onChange={setShape} />
      </div>

      <div className="map-frame">
        <svg
          ref={svg}
          className="map-svg map-canvas"
          viewBox={`0 0 ${size.cols * CELL} ${size.rows * CELL}`}
          width={size.cols * MAP_SCALE}
          height={size.rows * MAP_SCALE}
          role="application"
          tabIndex={0}
          aria-label={`Mapa ${name}, ${sizeText(size)}${cursor ? `; cursor en la columna ${cursor.x + 1}, fila ${cursor.y + 1}` : ''}`}
          aria-describedby="map-editor-hint"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          onFocus={() => setCursor((at) => at ?? { x: 0, y: 0 })}
        >
          <MapTerrain grid={grid} />
          {preview.map((cell) => (
            <rect
              key={cellKey(cell)}
              x={cell.x * CELL}
              y={cell.y * CELL}
              width={CELL}
              height={CELL}
              className="m-preview"
            />
          ))}
          {cursor && (
            <rect
              x={cursor.x * CELL + 2}
              y={cursor.y * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={4}
              className="m-cursor"
            />
          )}
        </svg>
      </div>
      <p className="hint" id="map-editor-hint">
        {PAINTS.find(([value]) => value === paint)?.[1]}: {PAINT_HINTS[paint]}.{' '}
        {shape === 'brush'
          ? 'Arrastra para pintar.'
          : shape === 'rect'
            ? 'Arrastra de una esquina a la otra.'
            : 'Arrastra de una esquina a la otra: se pinta el borde.'}{' '}
        Con el teclado, las flechas mueven el cursor y Espacio pinta.
      </p>
      <p className="muted">{sizeText(size)}</p>
      <MapLegend />
      <BackgroundPanel
        campaignId={map.campaignId}
        background={background}
        cols={size.cols}
        onChange={setBackground}
        onFit={setSize}
      />

      <div className="danger-zone">
        <ConfirmButton
          quiet
          confirmLabel={`¿Borrar ${map.name}? Las partidas que lo usaron lo conservan`}
          disabled={destroy.isPending}
          onConfirm={() => destroy.mutate()}
        >
          Borrar mapa
        </ConfirmButton>
        <ErrorNote error={destroy.error} />
      </div>
    </section>
  );
}
