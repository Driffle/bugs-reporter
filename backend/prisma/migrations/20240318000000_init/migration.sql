-- CreateTable
CREATE TABLE "processed_messages" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "ts" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "plane_id" TEXT NOT NULL,
    "plane_sequence_id" TEXT,
    "slack_message_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "slack_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_messages_message_id_key" ON "processed_messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_plane_id_key" ON "tickets"("plane_id");
