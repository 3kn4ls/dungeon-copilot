CREATE TABLE "npcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"concept" text DEFAULT '' NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"speech" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"secrets" text DEFAULT '' NOT NULL,
	"profile" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "npcs_campaign_id_idx" ON "npcs" USING btree ("campaign_id");