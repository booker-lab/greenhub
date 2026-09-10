"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVER_ORDER_ERROR_CODES = exports.DRIVER_ORDER_NOT_FOUND = exports.DRIVER_ORDER_STATE_CONFLICT = exports.DRIVER_ORDER_AUTHORITY_DENIED = void 0;
exports.isDriverOrderErrorCode = isDriverOrderErrorCode;
exports.DRIVER_ORDER_AUTHORITY_DENIED = 'DRIVER_ORDER_AUTHORITY_DENIED';
exports.DRIVER_ORDER_STATE_CONFLICT = 'DRIVER_ORDER_STATE_CONFLICT';
exports.DRIVER_ORDER_NOT_FOUND = 'DRIVER_ORDER_NOT_FOUND';
exports.DRIVER_ORDER_ERROR_CODES = [
    exports.DRIVER_ORDER_AUTHORITY_DENIED,
    exports.DRIVER_ORDER_STATE_CONFLICT,
    exports.DRIVER_ORDER_NOT_FOUND,
];
function isDriverOrderErrorCode(value) {
    return (value === exports.DRIVER_ORDER_AUTHORITY_DENIED ||
        value === exports.DRIVER_ORDER_STATE_CONFLICT ||
        value === exports.DRIVER_ORDER_NOT_FOUND);
}
