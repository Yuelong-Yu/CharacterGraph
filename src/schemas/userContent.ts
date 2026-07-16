import { z } from "zod";
import { Character, CharacterEvent, Relation } from "@/schemas/character";

export const UserCharacterScopeSchema = z.object({
  id: z.string().min(1).max(200),
  projectSlug: z.string().min(1).max(100),
  kind: z.literal("user-branch"),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const UserCharacterRecordSchema = z.object({
  id: z.string().min(1).max(200),
  projectSlug: z.string().min(1).max(100),
  scopeId: z.string().min(1).max(200),
  background: z.string().max(4000),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  character: Character,
  relations: z.array(Relation).max(1000),
}).refine((record) => record.id === record.character.id, {
  message: "人物记录 id 必须与 character.id 一致",
  path: ["character", "id"],
});

export const UserEventEntrySchema = z.object({
  id: z.string().min(1).max(200),
  event: CharacterEvent,
});

export const UserEventsSchema = z.record(z.string(), z.array(UserEventEntrySchema).max(1000));

export const UserContentImportSchema = z.object({
  activeScopeId: z.string().min(1).max(200).nullable(),
  scopes: z.array(UserCharacterScopeSchema).max(1000),
  characterRecords: z.array(UserCharacterRecordSchema).max(10000),
  userEvents: UserEventsSchema,
  initializedScopeIds: z.array(z.string().min(1).max(200)).max(10000),
});

export const UserProjectContentSnapshotSchema = UserContentImportSchema.extend({
  projectSlug: z.string(),
  revision: z.number().int().nonnegative(),
});

export const UserContentMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import-local"), content: UserContentImportSchema }),
  z.object({ action: z.literal("set-active-scope"), scopeId: z.string().min(1).max(200).nullable() }),
  z.object({
    action: z.literal("initialize-scope"),
    scopeId: z.string().min(1).max(200),
    seedRecords: z.array(UserCharacterRecordSchema).max(10000),
  }),
  z.object({ action: z.literal("upsert-character"), record: UserCharacterRecordSchema, scope: UserCharacterScopeSchema.optional(), activateScope: z.boolean().optional() }),
  z.object({ action: z.literal("delete-character"), scopeId: z.string().min(1).max(200), characterId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("upsert-event"), characterId: z.string().min(1).max(200), entry: UserEventEntrySchema }),
  z.object({ action: z.literal("delete-event"), characterId: z.string().min(1).max(200), eventId: z.string().min(1).max(200) }),
]).superRefine((input, context) => {
  if (input.action === "upsert-character" && input.scope && input.scope.id !== input.record.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scope.id 必须与 record.scopeId 一致",
      path: ["scope", "id"],
    });
  }
});

export type UserContentImport = z.infer<typeof UserContentImportSchema>;
export type UserProjectContentSnapshot = z.infer<typeof UserProjectContentSnapshotSchema>;
export type UserContentMutation = z.infer<typeof UserContentMutationSchema>;
