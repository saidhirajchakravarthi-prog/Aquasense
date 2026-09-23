// Helper to derive display unit from Firebase field name
export function deriveUnitFromField(fieldName: string): string {
  // Expected pattern: turbidity_<UNIT>
  const parts = fieldName.split('_');
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1];
    // Simple validation: all caps letters (e.g., NTU, FNU, FAU)
    if (/^[A-Z]+$/.test(suffix)) {
      return suffix;
    }
  }
  return 'Unit not provided';
}

