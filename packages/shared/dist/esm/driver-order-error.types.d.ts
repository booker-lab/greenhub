export declare const DRIVER_ORDER_AUTHORITY_DENIED = "DRIVER_ORDER_AUTHORITY_DENIED";
export declare const DRIVER_ORDER_STATE_CONFLICT = "DRIVER_ORDER_STATE_CONFLICT";
export declare const DRIVER_ORDER_NOT_FOUND = "DRIVER_ORDER_NOT_FOUND";
export type DriverOrderErrorCode = typeof DRIVER_ORDER_AUTHORITY_DENIED | typeof DRIVER_ORDER_STATE_CONFLICT | typeof DRIVER_ORDER_NOT_FOUND;
export declare const DRIVER_ORDER_ERROR_CODES: readonly DriverOrderErrorCode[];
export interface DriverOrderErrorEnvelope {
    statusCode: 403 | 404 | 409;
    message: string;
    error: string;
    code: DriverOrderErrorCode;
}
export declare function isDriverOrderErrorCode(value: unknown): value is DriverOrderErrorCode;
//# sourceMappingURL=driver-order-error.types.d.ts.map