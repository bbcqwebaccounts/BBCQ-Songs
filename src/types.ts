import { ParsedLyricPart } from './lib/songUtils';

export type AIProvider = 'gemini' | 'openai';

export interface SongMeta {
  lyrics: string;
  themes: string[];
  parts?: ParsedLyricPart[];
  verse_order?: string;
  embedding?: number[];
  embeddingProvider?: AIProvider;
}

export interface SongUsage {
  title: string;
  count: number;
  amCount: number;
  pmCount: number;
  lastUsed: Date;
  firstUsed: Date;
  datesUsed: { date: Date; type: 'AM' | 'PM' }[];
  lyrics?: string;
  themes?: string[];
  parts?: ParsedLyricPart[];
  verse_order?: string;
  embedding?: number[];
  embeddingProvider?: AIProvider;
}

export interface ServiceData {
  id?: string;
  date: Date;
  fileName: string;
  serviceType: 'AM' | 'PM';
  songs: string[];
}
