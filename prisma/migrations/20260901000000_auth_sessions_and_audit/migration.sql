-- Phase 1: authentication support tables.
--
--  * user_sessions     - the cookie carries an opaque id only (decision D-010),
--                       so a suspended account loses access immediately.
--  * login_attempts    - append-only, backs the per-account and per-IP rate
--                       limits and the lockout (decision D-012).
--  * password_resets   - one row per admin reset, so a temporary password and
--                       its use are auditable and cannot be replayed.

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "user_id" UUID,
    "ip" TEXT,
    "successful" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issued_by_id" UUID,
    "temporary" BOOLEAN NOT NULL DEFAULT true,
    "used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_at_idx" ON "login_attempts"("identifier", "at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_at_idx" ON "login_attempts"("ip", "at");

-- CreateIndex
CREATE INDEX "login_attempts_at_idx" ON "login_attempts"("at");

-- CreateIndex
CREATE INDEX "password_resets_user_id_used_at_idx" ON "password_resets"("user_id", "used_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
