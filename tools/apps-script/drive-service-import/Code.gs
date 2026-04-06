const CONFIG_KEYS = {
  projectId: 'FIREBASE_PROJECT_ID',
  databaseId: 'FIREBASE_DATABASE_ID',
  folderId: 'SERVICE_DRIVE_FOLDER_ID',
};

function importDailyServices() {
  const config = getConfig_();
  const folder = DriveApp.getFolderById(config.folderId);
  const files = folder.getFiles();
  const summary = {
    scanned: 0,
    importedFiles: 0,
    skippedFiles: 0,
    upsertedServices: 0,
    createdSongs: 0,
    errors: [],
  };
  const pendingFiles = [];

  while (files.hasNext()) {
    const file = files.next();
    summary.scanned += 1;

    if (!isSupportedServiceFile_(file.getName())) {
      summary.skippedFiles += 1;
      continue;
    }

    if (isAlreadyProcessed_(file)) {
      summary.skippedFiles += 1;
      continue;
    }
    pendingFiles.push(file);
  }

  if (pendingFiles.length === 0) {
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const masterSongs = fetchMasterSongs_(config.projectId, config.databaseId);

  pendingFiles.forEach((file) => {
    try {
      const parsed = parseServiceFile_(file, masterSongs);

      if (!parsed || parsed.service.songs.length === 0) {
        markProcessed_(file);
        summary.skippedFiles += 1;
        return;
      }

      for (const [title, meta] of Object.entries(parsed.songMetadata)) {
        const existing = masterSongs.find((song) => song.title === title);
        if (existing) {
          continue;
        }

        upsertSongDocument_(config.projectId, config.databaseId, {
          title,
          lyrics: meta.lyrics,
        });
        masterSongs.push({
          title,
          alternate_title: '',
          lyrics: meta.lyrics,
        });
        summary.createdSongs += 1;
      }

      upsertServiceDocument_(config.projectId, config.databaseId, parsed.service);
      markProcessed_(file);
      summary.importedFiles += 1;
      summary.upsertedServices += 1;
    } catch (error) {
      summary.errors.push(`${file.getName()}: ${String(error)}`);
    }
  });

  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function installDailyTrigger() {
  const handler = 'importDailyServices';
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
}

function testFirestoreConnection() {
  const config = getConfig_();
  const probe = probeFirestore_(config.projectId, config.databaseId);
  Logger.log(`Firestore reachable. Probe result: ${JSON.stringify(probe)}`);
  return probe;
}

function resetProcessedState() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach((key) => {
    if (key.indexOf('processed_file_') === 0) {
      props.deleteProperty(key);
    }
  });
}

function probeFirestore_(projectId, databaseId) {
  const url =
    firestoreBaseUrl_(projectId, databaseId) +
    '/services?pageSize=1&mask.fieldPaths=date&mask.fieldPaths=serviceType';
  const response = firestoreFetch_(url, { method: 'get' });
  return {
    documentsReturned: Array.isArray(response.documents) ? response.documents.length : 0,
    hasMore: Boolean(response.nextPageToken),
  };
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const projectId = props.getProperty(CONFIG_KEYS.projectId);
  const databaseId = props.getProperty(CONFIG_KEYS.databaseId) || '(default)';
  const folderId = props.getProperty(CONFIG_KEYS.folderId);

  if (!projectId) {
    throw new Error(`Missing Script Property ${CONFIG_KEYS.projectId}`);
  }

  if (!folderId) {
    throw new Error(`Missing Script Property ${CONFIG_KEYS.folderId}`);
  }

  return { projectId, databaseId, folderId };
}

function isSupportedServiceFile_(name) {
  const lower = String(name || '').toLowerCase();
  return (
    lower.endsWith('.osz') ||
    lower.endsWith('.zip') ||
    lower.endsWith('.osj') ||
    lower.endsWith('.json')
  );
}

function getProcessedKey_(fileId) {
  return `processed_file_${fileId}`;
}

function isAlreadyProcessed_(file) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(getProcessedKey_(file.getId()));
  const currentVersion = String(file.getLastUpdated().getTime());
  return stored === currentVersion;
}

function markProcessed_(file) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(
    getProcessedKey_(file.getId()),
    String(file.getLastUpdated().getTime()),
  );
}

function parseServiceFile_(file, masterSongs) {
  const jsonStr = extractJsonString_(file);
  if (!jsonStr) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error}`);
  }

  const songs = [];

  const extractSongs = function (items) {
    (items || []).forEach((item) => {
      const serviceItem = item && item.serviceitem ? item.serviceitem : item;
      const plugin = safeGet_(serviceItem, ['header', 'plugin']) || serviceItem.plugin;
      const name = safeGet_(serviceItem, ['header', 'name']) || serviceItem.name;

      if (plugin !== 'songs' && name !== 'songs') {
        return;
      }

      const rawTitle =
        safeGet_(serviceItem, ['header', 'title']) ||
        serviceItem.title ||
        safeGet_(serviceItem, ['header', 'name']) ||
        'Unknown Song';

      if (String(rawTitle).toLowerCase() === 'blank') {
        return;
      }

      let lyrics = '';
      if (serviceItem.data && Array.isArray(serviceItem.data)) {
        lyrics = serviceItem.data
          .map((row) => {
            let slideText = row.raw_slide || row.title || '';
            slideText = String(slideText)
              .replace(/\{.*?\}/g, '')
              .replace(/\[.*?\]/g, '')
              .trim();
            return slideText;
          })
          .filter(Boolean)
          .join('\n\n');
      }

      const matchedTitle = matchSong_(rawTitle, lyrics, masterSongs) || rawTitle;
      songs.push({
        title: matchedTitle,
        lyrics: lyrics,
      });
    });
  };

  if (Array.isArray(data)) {
    extractSongs(data);
  } else if (data && Array.isArray(data.items)) {
    extractSongs(data.items);
  } else if (data && data.service && Array.isArray(data.service.items)) {
    extractSongs(data.service.items);
  } else if (data && typeof data === 'object') {
    Object.keys(data).forEach((key) => {
      if (Array.isArray(data[key])) {
        extractSongs(data[key]);
      }
    });
  }

  const serviceDate = extractDateFromFilename_(file.getName(), file.getLastUpdated());
  const serviceType = file.getName().toLowerCase().indexOf('pm') >= 0 ? 'PM' : 'AM';
  const uniqueSongs = Array.from(new Set(songs.map((song) => song.title)));
  const songMetadata = {};

  songs.forEach((song) => {
    if (song.lyrics && !songMetadata[song.title]) {
      songMetadata[song.title] = {
        lyrics: song.lyrics,
      };
    }
  });

  return {
    service: {
      id: buildServiceDocId_(serviceDate, serviceType),
      date: toIsoDate_(serviceDate),
      fileName: file.getName(),
      serviceType: serviceType,
      songs: uniqueSongs,
    },
    songMetadata: songMetadata,
  };
}

function extractJsonString_(file) {
  const blob = file.getBlob();
  const lowerName = file.getName().toLowerCase();

  if (lowerName.endsWith('.osz') || lowerName.endsWith('.zip')) {
    const unzipped = Utilities.unzip(blob);
    for (let i = 0; i < unzipped.length; i += 1) {
      const entry = unzipped[i];
      const name = String(entry.getName() || '').toLowerCase();
      if (name.endsWith('.osj') || name.endsWith('.json')) {
        return entry.getDataAsString('UTF-8');
      }
    }
    return '';
  }

  return blob.getDataAsString('UTF-8');
}

function fetchMasterSongs_(projectId, databaseId) {
  const songs = [];
  let pageToken = '';

  do {
    let url =
      firestoreBaseUrl_(projectId, databaseId) +
      '/songs?pageSize=500&mask.fieldPaths=title&mask.fieldPaths=alternate_title&mask.fieldPaths=lyrics';

    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }

    const response = firestoreFetch_(url, { method: 'get' });
    const documents = response.documents || [];
    documents.forEach((doc) => {
      const data = fromFirestoreFields_(doc.fields || {});
      songs.push({
        title: data.title || '',
        alternate_title: data.alternate_title || '',
        lyrics: data.lyrics || '',
      });
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return songs;
}

function upsertSongDocument_(projectId, databaseId, song) {
  const docId = getSongDocId_(song.title);
  const url = firestoreDocumentUrl_(projectId, databaseId, `songs/${encodeURIComponent(docId)}`) +
    '?updateMask.fieldPaths=title&updateMask.fieldPaths=lyrics';

  firestoreFetch_(url, {
    method: 'patch',
    payload: JSON.stringify({
      fields: toFirestoreFields_({
        title: song.title,
        lyrics: song.lyrics || '',
      }),
    }),
  });
}

function upsertServiceDocument_(projectId, databaseId, service) {
  const existing = getDocumentIfExists_(projectId, databaseId, `services/${service.id}`);
  const existingSongs = existing && Array.isArray(existing.songs) ? existing.songs : [];
  const mergedSongs = Array.from(new Set([].concat(existingSongs, service.songs)));

  const url =
    firestoreDocumentUrl_(projectId, databaseId, `services/${encodeURIComponent(service.id)}`) +
    '?updateMask.fieldPaths=date' +
    '&updateMask.fieldPaths=fileName' +
    '&updateMask.fieldPaths=serviceType' +
    '&updateMask.fieldPaths=songs';

  firestoreFetch_(url, {
    method: 'patch',
    payload: JSON.stringify({
      fields: toFirestoreFields_({
        date: service.date,
        fileName: service.fileName,
        serviceType: service.serviceType,
        songs: mergedSongs,
      }),
    }),
  });
}

function getDocumentIfExists_(projectId, databaseId, docPath) {
  const url = firestoreDocumentUrl_(projectId, databaseId, docPath);
  try {
    const response = firestoreFetch_(url, { method: 'get' });
    return fromFirestoreFields_(response.fields || {});
  } catch (error) {
    if (String(error).indexOf('404') >= 0) {
      return null;
    }
    throw error;
  }
}

function firestoreFetch_(url, options) {
  const response = UrlFetchApp.fetch(url, {
    method: (options && options.method) || 'get',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    muteHttpExceptions: true,
    payload: options && options.payload ? options.payload : undefined,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`Firestore ${status}: ${body}`);
  }

  return body ? JSON.parse(body) : {};
}

function firestoreBaseUrl_(projectId, databaseId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function firestoreDocumentUrl_(projectId, databaseId, docPath) {
  return `${firestoreBaseUrl_(projectId, databaseId)}/${docPath}`;
}

function toFirestoreFields_(obj) {
  const fields = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value === undefined || value === null) {
      return;
    }
    fields[key] = toFirestoreValue_(value);
  });
  return fields;
}

function toFirestoreValue_(value) {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue_(item)),
      },
    };
  }

  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    if (Math.floor(value) === value) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields_(value),
      },
    };
  }

  return { stringValue: String(value) };
}

function fromFirestoreFields_(fields) {
  const output = {};
  Object.keys(fields || {}).forEach((key) => {
    output[key] = fromFirestoreValue_(fields[key]);
  });
  return output;
}

function fromFirestoreValue_(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) {
    const values = value.arrayValue.values || [];
    return values.map((entry) => fromFirestoreValue_(entry));
  }
  if ('mapValue' in value) {
    return fromFirestoreFields_(value.mapValue.fields || {});
  }
  return null;
}

function buildServiceDocId_(date, serviceType) {
  return `${toIsoDate_(date)}_${serviceType}`;
}

function getSongDocId_(title) {
  return String(title || '').replace(/\//g, '_');
}

function toIsoDate_(date) {
  return Utilities.formatDate(new Date(date), 'UTC', 'yyyy-MM-dd');
}

function safeGet_(obj, path) {
  return path.reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return null;
    }
    return current[key];
  }, obj);
}

function parseOpenLPLyrics_(xmlString) {
  if (!xmlString || (xmlString.indexOf('<?xml') === -1 && xmlString.indexOf('<song') === -1 && xmlString.indexOf('<lyrics>') === -1)) {
    return xmlString;
  }

  try {
    const cleaned = String(xmlString);
    const verseRegex = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi;
    const parts = [];
    let lyricsText = '';
    let match;

    while ((match = verseRegex.exec(cleaned)) !== null) {
      const attrs = match[1] || '';
      const body = match[2] || '';
      let type = getXmlAttr_(attrs, 'type');
      let label = getXmlAttr_(attrs, 'label');
      const name = getXmlAttr_(attrs, 'name');

      if (!type && !label && name) {
        type = name.charAt(0);
        label = name.substring(1) || '1';
      }

      type = type || 'v';
      label = label || '1';

      let text = body
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<lines[^>]*>/gi, '')
        .replace(/<\/lines>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (!text) {
        continue;
      }

      parts.push({ type: type, label: label, text: text });
      lyricsText += text + '\n\n';
    }

    return parts.length > 0 ? lyricsText.trim() : cleaned.replace(/<[^>]*>?/g, '').trim();
  } catch (error) {
    return String(xmlString).replace(/<[^>]*>?/g, '').trim();
  }
}

function getXmlAttr_(attrs, name) {
  const regex = new RegExp(name + '="([^"]*)"', 'i');
  const match = attrs.match(regex);
  return match ? match[1] : '';
}

function normalizeString_(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getWords_(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (word) { return word.length > 0; });
}

function getFirstLine_(lyrics) {
  if (!lyrics) return '';
  const parsed = parseOpenLPLyrics_(lyrics);
  const cleanLyrics = String(parsed).replace(/<[^>]*>?/g, '');
  const lines = cleanLyrics
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length > 0; });
  return lines.length > 0 ? lines[0] : '';
}

function getCleanFirstLineWords_(lyrics) {
  const firstLine = getFirstLine_(lyrics);
  if (!firstLine) return [];
  return firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(function (word) { return word.length > 0; });
}

function getWordOverlapScore_(words1, words2) {
  if (!words1.length || !words2.length) return 0;
  const dp = [];
  for (let i = 0; i <= words1.length; i += 1) {
    dp[i] = [];
    for (let j = 0; j <= words2.length; j += 1) {
      dp[i][j] = 0;
    }
  }

  for (let i = 1; i <= words1.length; i += 1) {
    for (let j = 1; j <= words2.length; j += 1) {
      if (words1[i - 1] === words2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[words1.length][words2.length] / words1.length;
}

function matchSong_(importedTitle, importedLyrics, masterSongs) {
  if (!masterSongs || masterSongs.length === 0) {
    return null;
  }

  const normImportedTitle = normalizeString_(importedTitle);
  const importedWords = getCleanFirstLineWords_(importedLyrics);
  const importedTitleWords = getWords_(importedTitle);
  let match = null;

  match = masterSongs.find(function (song) {
    return song.title && normalizeString_(song.title) === normImportedTitle;
  });
  if (match) return match.title;

  match = masterSongs.find(function (song) {
    return song.alternate_title && normalizeString_(song.alternate_title) === normImportedTitle;
  });
  if (match) return match.title;

  match = masterSongs.find(function (song) {
    const normMaster = normalizeString_(song.title);
    return normMaster.length > 5 &&
      normImportedTitle.length > 5 &&
      (normImportedTitle.indexOf(normMaster) >= 0 || normMaster.indexOf(normImportedTitle) >= 0);
  });
  if (match) return match.title;

  if (importedWords.length > 0) {
    const uniqueCounts = Array.from(new Set([5, 10, importedWords.length]))
      .filter(function (count) { return count <= importedWords.length; })
      .sort(function (a, b) { return a - b; });

    if (uniqueCounts.indexOf(importedWords.length) === -1) {
      uniqueCounts.push(importedWords.length);
    }

    for (let i = 0; i < uniqueCounts.length; i += 1) {
      const count = uniqueCounts[i];
      const matches = masterSongs.filter(function (song) {
        const masterWords = getCleanFirstLineWords_(song.lyrics || '');
        if (masterWords.length === 0) return false;

        const wordsToCompare = Math.min(masterWords.length, importedWords.length, count);
        const masterSearchWords = masterWords.slice(0, wordsToCompare).join('');
        const importedSearchWords = importedWords.slice(0, wordsToCompare).join('');
        return masterSearchWords === importedSearchWords;
      });

      if (matches.length === 1) return matches[0].title;
      if (matches.length === 0) break;
    }
  }

  if (importedTitleWords.length >= 3) {
    const matches = masterSongs.filter(function (song) {
      const masterTitleWords = getWords_(song.title);
      return getWordOverlapScore_(importedTitleWords, masterTitleWords) >= 0.8;
    });
    if (matches.length === 1) return matches[0].title;
  }

  if (importedWords.length >= 5) {
    const matches = masterSongs.filter(function (song) {
      const masterWords = getCleanFirstLineWords_(song.lyrics || '');
      return getWordOverlapScore_(importedWords, masterWords) >= 0.8;
    });
    if (matches.length === 1) return matches[0].title;
  }

  return null;
}

function extractDateFromFilename_(filename, fallbackDate) {
  const yyyyMmDdMatch = String(filename).match(/(\d{4})[-_.](\d{2})[-_.](\d{2})/);
  if (yyyyMmDdMatch) {
    return new Date(
      Number(yyyyMmDdMatch[1]),
      Number(yyyyMmDdMatch[2]) - 1,
      Number(yyyyMmDdMatch[3]),
    );
  }

  const ddMmYyyyMatch = String(filename).match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
  if (ddMmYyyyMatch) {
    return new Date(
      Number(ddMmYyyyMatch[3]),
      Number(ddMmYyyyMatch[2]) - 1,
      Number(ddMmYyyyMatch[1]),
    );
  }

  const ddMmYyMatch = String(filename).match(/(\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (ddMmYyMatch) {
    const year = Number(ddMmYyMatch[3]);
    const fullYear = year < 50 ? 2000 + year : 1900 + year;
    return new Date(
      fullYear,
      Number(ddMmYyMatch[2]) - 1,
      Number(ddMmYyMatch[1]),
    );
  }

  return fallbackDate;
}
