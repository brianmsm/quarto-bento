/** Source identifiers are global; native identifiers are scoped to a slide. */
export const isSourceIdentity = (value: string): boolean =>
  /^[\p{L}_][\p{L}\p{N}\p{M}_.:-]*$/u.test(value);
/** Existing mapped children can contain '/', and Unicode automatic heading IDs. */
export const isNativeIdentity = (value: string): boolean =>
  /^[\p{L}_][\p{L}\p{N}\p{M}_.:/-]*$/u.test(value);
