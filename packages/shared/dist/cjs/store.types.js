"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SALES_MODE = void 0;
exports.normalizeSalesMode = normalizeSalesMode;
exports.DEFAULT_SALES_MODE = 'legacy';
function normalizeSalesMode(salesMode) {
    return salesMode ?? exports.DEFAULT_SALES_MODE;
}
