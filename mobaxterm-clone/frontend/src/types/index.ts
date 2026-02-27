import { db } from '../../wailsjs/go/models';

export interface Tab {
    id: string;
    title: string;
    sessionId: string;
    configId?: string;
}

export interface SavedSession extends db.CommandLog {
    // Basic fields are in db.CommandLog, but we often use the full Config
}

// Re-export common types and values
export { db };
