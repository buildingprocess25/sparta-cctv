-- Kualitas sesi live (1 HD, 2 sub-stream) untuk pembatas multi-live per akun
ALTER TABLE "LiveSession" ADD COLUMN "quality" INTEGER NOT NULL DEFAULT 2;
