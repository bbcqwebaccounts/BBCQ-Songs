import { format, parse, isValid } from 'date-fns';

export interface ParsedLyricPart {
  type: string;
  label: string;
  text: string;
}

export interface ParsedLyricsResult {
  text: string;
  parts: ParsedLyricPart[];
}

export const parseOpenLPLyrics = (xmlString: string): ParsedLyricsResult | string => {
  if (!xmlString || (!xmlString.includes('<?xml') && !xmlString.includes('<song') && !xmlString.includes('<lyrics>'))) {
    return xmlString;
  }
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const verses = xmlDoc.getElementsByTagName("verse");
    let lyricsText = "";
    const parts: ParsedLyricPart[] = [];
    
    for (let i = 0; i < verses.length; i++) {
      const verse = verses[i];
      let type = verse.getAttribute("type");
      let label = verse.getAttribute("label");
      
      // Handle OpenLyrics format (e.g., name="v1")
      if (!type && !label) {
        const name = verse.getAttribute("name");
        if (name && name.length >= 1) {
          type = name.charAt(0);
          label = name.substring(1) || "1";
        }
      }
      
      type = type || "v";
      label = label || "1";
      
      // In OpenLyrics, the text is inside <lines> tags
      const linesTags = verse.getElementsByTagName("lines");
      let text = "";
      if (linesTags.length > 0) {
        for (let j = 0; j < linesTags.length; j++) {
          text += linesTags[j].textContent?.trim() + "\n";
        }
        text = text.trim();
      } else {
        text = verse.textContent?.trim() || "";
      }
      
      parts.push({ type, label, text });
      lyricsText += text + "\n\n";
    }
    
    const cleanText = lyricsText.trim() || xmlString.replace(/<[^>]*>?/gm, '').trim();
    return { text: cleanText, parts };
  } catch (e) {
    console.error("Failed to parse lyrics XML", e);
    return xmlString.replace(/<[^>]*>?/gm, '').trim();
  }
};

export const normalizeString = (str: string) => {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const getFirstLine = (lyrics: string | ParsedLyricsResult) => {
  if (!lyrics) return '';
  let cleanLyrics = '';
  if (typeof lyrics === 'string') {
    const parsedLyrics = parseOpenLPLyrics(lyrics);
    cleanLyrics = typeof parsedLyrics === 'string' ? parsedLyrics.replace(/<[^>]*>?/gm, '') : parsedLyrics.text.replace(/<[^>]*>?/gm, '');
  } else {
    cleanLyrics = lyrics.text.replace(/<[^>]*>?/gm, '');
  }
  const lines = cleanLyrics.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines.length > 0 ? lines[0] : '';
};

export const getCleanFirstLineWords = (lyrics: string | ParsedLyricsResult) => {
  const firstLine = getFirstLine(lyrics);
  if (!firstLine) return [];
  return firstLine.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
};

export const getWords = (str: string) => {
  if (!str) return [];
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);
};

export const getWordOverlapScore = (words1: string[], words2: string[]) => {
  if (words1.length === 0 || words2.length === 0) return 0;
  const dp = Array(words1.length + 1).fill(0).map(() => Array(words2.length + 1).fill(0));
  for (let i = 1; i <= words1.length; i++) {
    for (let j = 1; j <= words2.length; j++) {
      if (words1[i - 1] === words2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[words1.length][words2.length] / words1.length;
};

export const matchSong = (importedTitle: string, importedLyrics: string, masterSongsList: any[]): string | null => {
  if (!masterSongsList || masterSongsList.length === 0) return null;

  const normImportedTitle = normalizeString(importedTitle);
  const importedWords = getCleanFirstLineWords(importedLyrics);
  const importedTitleWords = getWords(importedTitle);

  let match;

  // 1. Exact title match
  match = masterSongsList.find(s => s.title && normalizeString(s.title) === normImportedTitle);
  if (match) return match.title;

  // 2. Alternate title match
  match = masterSongsList.find(s => s.alternate_title && normalizeString(s.alternate_title) === normImportedTitle);
  if (match) return match.title;

  // 3. Contains match (e.g., "BH42: In Christ Alone" contains "In Christ Alone")
  match = masterSongsList.find(s => {
    const normMaster = normalizeString(s.title);
    return normMaster.length > 5 && normImportedTitle.length > 5 && 
           (normImportedTitle.includes(normMaster) || normMaster.includes(normImportedTitle));
  });
  if (match) return match.title;

  // 4. Lyrics match by progressive word count
  if (importedWords.length > 0) {
    const uniqueCounts = [...new Set([5, 10, importedWords.length])].filter(c => c <= importedWords.length).sort((a, b) => a - b);
    if (!uniqueCounts.includes(importedWords.length)) uniqueCounts.push(importedWords.length);
    
    for (const count of uniqueCounts) {
      const matches = masterSongsList.filter(s => {
        const masterWords = getCleanFirstLineWords(s.lyrics || s.search_lyrics || '');
        if (masterWords.length === 0) return false;
        
        const wordsToCompare = Math.min(masterWords.length, importedWords.length, count);
        const masterSearchWords = masterWords.slice(0, wordsToCompare).join('');
        const currentSearchWords = importedWords.slice(0, wordsToCompare).join('');
        
        return masterSearchWords === currentSearchWords;
      });

      if (matches.length === 1) {
        return matches[0].title;
      } else if (matches.length === 0) {
        // If no matches at this word count, adding more words won't find a match
        break;
      }
    }
  }

  // 5. Fuzzy Title Match
  if (importedTitleWords.length >= 3) {
    const matches = masterSongsList.filter(s => {
      const masterTitleWords = getWords(s.title);
      const score = getWordOverlapScore(importedTitleWords, masterTitleWords);
      return score >= 0.8;
    });
    if (matches.length === 1) return matches[0].title;
  }

  // 6. Fuzzy Lyrics Match
  if (importedWords.length >= 5) {
    const matches = masterSongsList.filter(s => {
      const masterWords = getCleanFirstLineWords(s.lyrics || s.search_lyrics || '');
      const score = getWordOverlapScore(importedWords, masterWords);
      return score >= 0.8;
    });
    if (matches.length === 1) return matches[0].title;
  }

  // No match found
  return null;
};

export const extractDateFromFilename = (filename: string, fileDate: Date): Date => {
  const yyyyMmDdMatch = filename.match(/(\d{4})[-_.](\d{2})[-_.](\d{2})/);
  if (yyyyMmDdMatch) {
    const date = new Date(parseInt(yyyyMmDdMatch[1]), parseInt(yyyyMmDdMatch[2]) - 1, parseInt(yyyyMmDdMatch[3]));
    if (isValid(date)) return date;
  }

  const ddMmYyyyMatch = filename.match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
  if (ddMmYyyyMatch) {
    const date = new Date(parseInt(ddMmYyyyMatch[3]), parseInt(ddMmYyyyMatch[2]) - 1, parseInt(ddMmYyyyMatch[1]));
    if (isValid(date)) return date;
  }

  const ddMmYyMatch = filename.match(/(\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (ddMmYyMatch) {
    const year = parseInt(ddMmYyMatch[3]);
    const fullYear = year < 50 ? 2000 + year : 1900 + year;
    const date = new Date(fullYear, parseInt(ddMmYyMatch[2]) - 1, parseInt(ddMmYyMatch[1]));
    if (isValid(date)) return date;
  }

  return fileDate;
};

export const formatLyricLabel = (type: string, label: string) => {
  const t = type.toLowerCase();
  if (t === 'v') return `Verse ${label}`;
  if (t === 'c') return `Chorus ${label}`;
  if (t === 'b') return `Bridge ${label}`;
  if (t === 'p') return `Pre-Chorus ${label}`;
  if (t === 'e') return `Ending ${label}`;
  if (t === 'i') return `Intro ${label}`;
  if (t === 'o') return `Other ${label}`;
  return `${type} ${label}`.toUpperCase();
};
