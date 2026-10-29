// Remove explicit shelf-stable product phrases before matching cold/fresh
// keywords. Keep surrounding words so e.g. "Frozen Peanut Butter" still fails.
export function shelfStableFoodFilterText(value = '') {
  return value.replace(/\b(?:peanut butter|swedish fish|fish oil|canned (?:fish|meat)|dried meat|meat snacks?|shelf[ -]stable dairy)\b/gi, '');
}
