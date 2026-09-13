/** Structural bounds, not measured browser capacity or permission to allocate residents. */
export const SHARED_LIMITS = Object.freeze({ minMembers: 2, maxMembers: 64, requestBytes: 65536, rasterBudgetMs: 125 });
export const validSharedCount = count => Number.isInteger(count) && count >= SHARED_LIMITS.minMembers && count <= SHARED_LIMITS.maxMembers;
