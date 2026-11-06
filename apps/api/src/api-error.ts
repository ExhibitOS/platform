// SPDX-License-Identifier: AGPL-3.0-or-later
export class ApiError extends Error { readonly status:number; readonly code:string; constructor(status:number,code:string) {super(code);this.status=status;this.code=code;} }
