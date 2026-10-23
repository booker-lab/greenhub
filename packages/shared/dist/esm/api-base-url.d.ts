export declare const DEVELOPMENT_API_BASE_URL = "http://localhost:3000";
export declare class ApiConfigurationError extends Error {
    constructor(message: string);
}
export declare function resolveApiBaseUrl({ configuredUrl, nodeEnv, developmentFallback, }: {
    configuredUrl?: string;
    nodeEnv: string | undefined;
    developmentFallback?: string;
}): string;
//# sourceMappingURL=api-base-url.d.ts.map