export type AudioHistoryRecord = {
  id: string;
  createdAt: string;
  provider: string;
  language: string;
  responseTimeMs: number;
  audioBytes: number;
  inputChars: number;
  cached: boolean;
  providerInputTokens?: number;
  providerOutputTokens?: number;
  mime: string;
  audio: Blob;
};

const DATABASE_NAME = "speak-api-audio-history";
const STORE_NAME = "generations";
const DATABASE_VERSION = 1;
const MAX_RECORDS = 100;
const MAX_STORAGE_BYTES = 50 * 1024 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open audio history"));
  });
}

export async function listAudioHistory(): Promise<AudioHistoryRecord[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as AudioHistoryRecord[]).sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          ),
        );
      request.onerror = () => reject(request.error ?? new Error("Could not load audio history"));
    });
  } finally {
    database.close();
  }
}

export async function saveAudioHistory(record: AudioHistoryRecord): Promise<void> {
  if (record.audio.size > MAX_STORAGE_BYTES) {
    throw new Error("This audio is too large to save in browser history.");
  }

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = (request.result as AudioHistoryRecord[])
          .filter((existing) => existing.id !== record.id)
          .concat(record)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        let totalBytes = 0;
        const retained: AudioHistoryRecord[] = [];

        for (const candidate of records) {
          if (
            retained.length >= MAX_RECORDS ||
            totalBytes + candidate.audio.size > MAX_STORAGE_BYTES
          ) {
            store.delete(candidate.id);
            continue;
          }
          retained.push(candidate);
          totalBytes += candidate.audio.size;
        }

        store.put(record);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not save audio history"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Could not save audio history"));
    });
  } finally {
    database.close();
  }
}
