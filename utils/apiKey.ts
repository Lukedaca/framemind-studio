
import { apiKeyManager, type ApiKeyStorageMode } from '../services/apiKeyManager';

export const initApiKeyStorage = () => {
    apiKeyManager.clearLegacyKeys();
    apiKeyManager.init();
};

export const setApiKey = (key: string) => {
    apiKeyManager.save(key);
};

export const getApiKey = (): string | null => {
    return apiKeyManager.get();
};

export const hasApiKey = (): boolean => {
    return !!getApiKey();
};

export const clearApiKey = () => {
    apiKeyManager.clear();
};

export const setApiKeyStorageMode = (mode: ApiKeyStorageMode) => {
    apiKeyManager.setMode(mode);
};

export const isSessionOnly = (): boolean => {
    return apiKeyManager.isSessionOnly();
};
