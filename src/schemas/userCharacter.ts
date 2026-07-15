import { z } from "zod";

export const UserCharacterCandidate = z.object({
  id: z.string().min(1),
  nameZh: z.string().min(1),
  epithet: z.string().nullish(),
  bio: z.string().nullish(),
  category: z.string().min(1),
  eraLayer: z.number().int().min(0).max(5),
});
export type UserCharacterCandidate = z.infer<typeof UserCharacterCandidate>;

export const GenerateUserCharacterInput = z.object({
  projectSlug: z.string().min(1),
  nameZh: z.string().trim().min(1).max(40),
  background: z.string().trim().min(1).max(2000),
  category: z.string().min(1),
  eraLayer: z.number().int().min(0).max(5),
  aliases: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  epithet: z.string().trim().max(80).nullish(),
  relationCount: z.number().int().min(0),
  requiredCharacterIds: z.array(z.string().min(1)).default([]),
  candidates: z.array(UserCharacterCandidate).max(1000),
});
export type GenerateUserCharacterInput = z.infer<typeof GenerateUserCharacterInput>;

export const GeneratedProfile = z.object({
  nameEn: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  epithet: z.string().trim().min(1).max(80).nullable(),
  bio: z.string().trim().min(1).max(2000),
  events: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    desc: z.string().trim().min(1).max(1000),
  })).min(1).max(10),
  weapons: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  skills: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  domains: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  mounts: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});
export type GeneratedProfile = z.infer<typeof GeneratedProfile>;

export const GeneratedRelationship = z.object({
  targetId: z.string().min(1),
  primaryType: z.string().min(1),
  compositeTypes: z.array(z.string().min(1)).default([]),
  title: z.string().trim().min(1).max(100),
  desc: z.string().trim().min(1).max(1200),
});
export type GeneratedRelationship = z.infer<typeof GeneratedRelationship>;

export const GeneratedRelationshipBatch = z.object({
  relationships: z.array(GeneratedRelationship),
});

export const GeneratedTargetSelection = z.object({
  targetIds: z.array(z.string().min(1)),
});

export const UserCharacterGenerationResult = z.object({
  profile: GeneratedProfile,
  relationships: z.array(GeneratedRelationship),
});
export type UserCharacterGenerationResult = z.infer<typeof UserCharacterGenerationResult>;

