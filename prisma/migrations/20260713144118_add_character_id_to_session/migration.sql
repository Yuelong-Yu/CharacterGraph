/*
  Warnings:

  - Added the required column `characterId` to the `WhatIfSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WhatIfSession" ADD COLUMN     "characterId" TEXT NOT NULL;
