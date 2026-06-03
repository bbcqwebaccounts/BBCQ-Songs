import React, { useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  cosineSimilarity,
  createEmbeddingWithFallback,
  generateJsonWithFallback,
  getConfiguredAiProviders,
  getPreferredAiProvider,
} from '../lib/aiClient';

export function useAIRecommendations(allSongs: any[]) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<{ title: string; reason: string }[] | null>(null);

  const [processingEmbeddings, setProcessingEmbeddings] = useState(false);
  const [embeddingProgress, setEmbeddingProgress] = useState({ current: 0, total: 0 });

  const [generatingThemes, setGeneratingThemes] = useState(false);
  const [themeProgress, setThemeProgress] = useState({ current: 0, total: 0 });

  const getAiRecommendations = async (append: boolean = false) => {
    if (!aiPrompt.trim()) return;

    setIsAiLoading(true);
    try {
      const existingTitles = append && aiRecommendations ? aiRecommendations.map((rec) => rec.title) : [];
      let candidateSongs = allSongs.filter((song) => !existingTitles.includes(song.title));

      let retrievalProvider = getPreferredAiProvider();
      if (retrievalProvider) {
        try {
          const embeddingResult = await createEmbeddingWithFallback(aiPrompt);
          retrievalProvider = embeddingResult.provider;
          const promptEmbedding = embeddingResult.embeddings[0];

          const songsWithEmbeddings = candidateSongs.filter(
            (song) =>
              song.embedding &&
              song.embeddingProvider === retrievalProvider,
          );

          if (songsWithEmbeddings.length > 0) {
            const scoredSongs = songsWithEmbeddings
              .map((song) => ({
                ...song,
                score: cosineSimilarity(promptEmbedding, song.embedding!),
              }))
              .sort((a, b) => b.score - a.score);

            candidateSongs = mergeSongCandidates(
              scoredSongs.slice(0, 100),
              rankSongsByText(candidateSongs, aiPrompt).slice(0, 80),
            ).slice(0, 150);
          } else {
            candidateSongs = rankSongsByText(candidateSongs, aiPrompt).slice(0, 150);
          }
        } catch (error) {
          console.warn('Embedding retrieval failed; continuing without vector search.', error);
          candidateSongs = rankSongsByText(candidateSongs, aiPrompt).slice(0, 150);
        }
      } else {
        candidateSongs = rankSongsByText(candidateSongs, aiPrompt).slice(0, 150);
      }

      const songContext = candidateSongs
        .slice(0, 150)
        .map(
          (song) =>
            `Title: ${song.title}\nThemes: ${song.themes?.join(', ') || 'None'}\nLyrics Snippet: ${song.lyrics?.substring(0, 220).replace(/\n/g, ' ') || 'None'}...`,
        )
        .join('\n\n');

      const prompt = `You are a worship leader assistant. Based on the following sermon summary or topic, recommend ${append ? '3 to 5' : '5 to 10'} songs from the provided list of available songs.

Sermon Summary/Topic: ${aiPrompt}

Available Songs:
${songContext}

${existingTitles.length > 0 ? `Do NOT recommend these songs as they are already listed: ${existingTitles.join(', ')}.` : ''}

Return only a JSON array of objects with:
- "title": must exactly match a full song title from the list, including the hymn code such as BH104 or TH100
- "reason": a short 1-2 sentence explanation of why it fits`;

      const { result } = await generateJsonWithFallback<{ title: string; reason: string }[]>(prompt);
      const filtered = normalizeRecommendations(Array.isArray(result) ? result : [], allSongs);
      const nextRecommendations =
        filtered.length > 0
          ? filtered
          : candidateSongs.slice(0, append ? 3 : 5).map((song) => ({
              title: song.title,
              reason:
                'This was one of the closest available matches from the song index for the requested theme.',
            }));

      if (append && aiRecommendations) {
        setAiRecommendations([...aiRecommendations, ...nextRecommendations]);
      } else {
        setAiRecommendations(nextRecommendations);
      }
    } catch (error) {
      console.error('AI recommendation failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to get recommendations. Please try again.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleProcessEmbeddings = async (onlyUnprocessed: boolean) => {
    const preferredProvider = getPreferredAiProvider();

    if (!preferredProvider) {
      alert('A Gemini or OpenAI API key is required.');
      return;
    }

    setProcessingEmbeddings(true);
    try {
      const songsToProcess = allSongs.filter((song) => {
        if (!onlyUnprocessed) return true;
        return !song.embedding || song.embeddingProvider !== preferredProvider;
      });

      if (songsToProcess.length === 0) {
        alert('No songs to process.');
        setProcessingEmbeddings(false);
        return;
      }

      setEmbeddingProgress({ current: 0, total: songsToProcess.length });

      const batchSize = 50;
      for (let i = 0; i < songsToProcess.length; i += batchSize) {
        const batchSongs = songsToProcess.slice(i, i + batchSize);
        const input = batchSongs.map(
          (song) => `Title: ${song.title}\nThemes: ${song.themes?.join(', ')}\nLyrics: ${song.lyrics || ''}`,
        );

        const embeddingResult = await createEmbeddingWithFallback(input);
        const batch = writeBatch(db);

        batchSongs.forEach((song, idx) => {
          const safeId = song.title.replace(/\//g, '_');
          batch.update(doc(db, 'songs', safeId), {
            embedding: embeddingResult.embeddings[idx],
            embeddingProvider: embeddingResult.provider,
          });
        });

        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'songs');
        }

        setEmbeddingProgress((prev) => ({
          ...prev,
          current: Math.min(prev.total, i + batchSongs.length),
        }));

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      alert('AI index processed successfully.');
    } catch (error) {
      console.error('Failed to process embeddings:', error);
      alert(error instanceof Error ? error.message : 'Failed to process embeddings. Check console for details.');
    } finally {
      setProcessingEmbeddings(false);
    }
  };

  const handleGenerateMissingThemes = async () => {
    if (getConfiguredAiProviders().length === 0) {
      alert('A Gemini or OpenAI API key is required.');
      return;
    }

    setGeneratingThemes(true);
    try {
      const songsToProcess = allSongs.filter((song) => !song.themes || song.themes.length === 0);

      if (songsToProcess.length === 0) {
        alert('All songs already have themes.');
        setGeneratingThemes(false);
        return;
      }

      setThemeProgress({ current: 0, total: songsToProcess.length });

      const batchSize = 10;
      for (let i = 0; i < songsToProcess.length; i += batchSize) {
        const batchSongs = songsToProcess.slice(i, i + batchSize);

        const prompt = `You are a worship leader assistant. Analyze the lyrics of the following songs and generate 1-3 relevant themes for each.

Songs:
${batchSongs
  .map((song) => `Title: ${song.title}\nLyrics: ${song.lyrics?.substring(0, 500) || ''}`)
  .join('\n\n')}

Return only a JSON array of objects with:
- "title": exactly matching the input title
- "themes": an array of 1-3 short strings`;

        const { result } = await generateJsonWithFallback<{ title: string; themes: string[] }[]>(prompt);

        const batch = writeBatch(db);
        (Array.isArray(result) ? result : []).forEach((rec) => {
          const safeId = rec.title.replace(/\//g, '_');
          batch.update(doc(db, 'songs', safeId), {
            themes: Array.isArray(rec.themes) ? rec.themes : [],
          });
        });

        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'songs');
        }

        setThemeProgress((prev) => ({
          ...prev,
          current: Math.min(prev.total, i + batchSongs.length),
        }));

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      alert('Missing themes generated successfully.');
    } catch (error) {
      console.error('Failed to generate themes:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate themes. Check console for details.');
    } finally {
      setGeneratingThemes(false);
    }
  };

  return {
    aiPrompt,
    setAiPrompt,
    isAiLoading,
    aiRecommendations,
    setAiRecommendations,
    processingEmbeddings,
    embeddingProgress,
    generatingThemes,
    themeProgress,
    getAiRecommendations,
    handleProcessEmbeddings,
    handleGenerateMissingThemes,
  };
}

function mergeSongCandidates(primary: any[], secondary: any[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((song) => {
    if (!song?.title || seen.has(song.title)) return false;
    seen.add(song.title);
    return true;
  });
}

function rankSongsByText(songs: any[], prompt: string) {
  const terms = tokenize(prompt);
  if (terms.length === 0) return songs;

  return [...songs]
    .map((song) => ({
      ...song,
      textScore: scoreSongText(song, terms),
    }))
    .sort((a, b) => b.textScore - a.textScore);
}

function scoreSongText(song: any, terms: string[]) {
  const title = normalizeText(song.title);
  const themes = normalizeText((song.themes || []).join(' '));
  const lyrics = normalizeText(song.lyrics || '');

  return terms.reduce((score, term) => {
    let nextScore = score;
    if (title.includes(term)) nextScore += 8;
    if (themes.includes(term)) nextScore += 5;
    if (lyrics.includes(term)) nextScore += 1;
    return nextScore;
  }, 0);
}

function normalizeRecommendations(
  recommendations: { title: string; reason: string }[],
  allSongs: any[],
) {
  const byExactTitle = new Map(allSongs.map((song) => [song.title, song.title]));
  const byNormalizedTitle = new Map(
    allSongs.map((song) => [normalizeTitle(song.title), song.title]),
  );
  const byCode = new Map(
    allSongs
      .map((song) => [getSongCode(song.title), song.title] as const)
      .filter(([code]) => Boolean(code)),
  );
  const titleOptions = allSongs.map((song) => ({
    title: song.title,
    normalized: normalizeTitle(song.title),
    withoutCode: normalizeTitle(stripSongCode(song.title)),
  }));
  const seen = new Set<string>();

  return recommendations
    .map((rec) => {
      const normalizedRecTitle = normalizeTitle(rec.title);
      const recCode = getSongCode(rec.title);
      const title =
        byExactTitle.get(rec.title) ||
        byNormalizedTitle.get(normalizedRecTitle) ||
        (recCode ? byCode.get(recCode) : undefined) ||
        titleOptions.find(
          (option) =>
            option.withoutCode === normalizedRecTitle ||
            option.withoutCode.startsWith(normalizedRecTitle) ||
            normalizedRecTitle.startsWith(option.withoutCode),
        )?.title;

      if (!title || seen.has(title)) return null;
      seen.add(title);

      return {
        title,
        reason: rec.reason || 'This song fits the requested theme.',
      };
    })
    .filter(Boolean) as { title: string; reason: string }[];
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function normalizeTitle(title: string) {
  return normalizeText(title).replace(/\s+/g, ' ').trim();
}

function getSongCode(title: string) {
  return title.match(/^[A-Z]{1,4}\d+[A-Z]?/i)?.[0].toUpperCase() || '';
}

function stripSongCode(title: string) {
  return title.replace(/^[A-Z]{1,4}\d+[A-Z]?\s*:\s*/i, '');
}
