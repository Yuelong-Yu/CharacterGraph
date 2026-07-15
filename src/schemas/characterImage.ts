import { z } from "zod";
import { Character } from "./character";

const CharacterImageBaseInput = z.object({
  projectSlug: z.string().regex(/^[a-z][a-z0-9_]*$/),
  branchId: z.string().trim().min(1).max(200),
});

export const CharacterImageStatusInput = CharacterImageBaseInput.extend({
  action: z.literal("status"),
  characterIds: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(500),
});

export const GenerateCharacterImageInput = CharacterImageBaseInput.extend({
  action: z.literal("generate"),
  character: Character,
  background: z.string().max(4000).optional(),
  regenerate: z.boolean().default(false),
});

export const CharacterImageRequest = z.discriminatedUnion("action", [
  CharacterImageStatusInput,
  GenerateCharacterImageInput,
]);
export type CharacterImageRequest = z.infer<typeof CharacterImageRequest>;

export interface CharacterImageAsset {
  portrait: string;
  thumb: string;
  ownerBranchId: string;
  version: string;
}
