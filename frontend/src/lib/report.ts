import type { ReportRow } from '../api/types';

export const ALL_CENTERS_VALUE = '__all_centers__';

export interface CenterOption {
  value: string;
  label: string;
}

export const buildCenterOptions = (rows: readonly ReportRow[]): CenterOption[] => {
  const centerNames = Array.from(new Set(rows.map((row) => row.centerName).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );

  return [
    { value: ALL_CENTERS_VALUE, label: 'All Centers' },
    ...centerNames.map((centerName) => ({ value: centerName, label: centerName })),
  ];
};

export const filterRowsByCenter = (
  rows: readonly ReportRow[],
  selectedCenterName: string,
): readonly ReportRow[] => {
  if (selectedCenterName === ALL_CENTERS_VALUE) {
    return rows;
  }

  return rows.filter((row) => row.centerName === selectedCenterName);
};
