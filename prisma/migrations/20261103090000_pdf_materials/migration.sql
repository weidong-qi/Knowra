ALTER TABLE "Note" ADD COLUMN "contentKind" TEXT NOT NULL DEFAULT 'markdown', ADD COLUMN "pdfSource" JSONB;
CREATE TABLE "PdfAnnotation" ("id" TEXT PRIMARY KEY, "noteId" TEXT NOT NULL REFERENCES "Note"("id") ON DELETE CASCADE, "revision" INTEGER NOT NULL, "payload" JSONB NOT NULL);
CREATE INDEX "PdfAnnotation_noteId_idx" ON "PdfAnnotation"("noteId");
