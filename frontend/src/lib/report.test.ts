import { describe, expect, it } from 'vitest';
import { ALL_CENTERS_VALUE, buildCenterOptions, filterRowsByCenter } from './report';
import type { ReportRow } from '../api/types';

const makeRow = (centerName: string, accountNumber: string): ReportRow => ({
  centerName,
  accountNumber,
  studentName: `Student ${accountNumber}`,
  parentName: `Parent ${accountNumber}`,
  phoneNumber: '555-0101',
  email: `${accountNumber}@example.com`,
});

describe('buildCenterOptions', () => {
  it('returns All Centers plus unique center names sorted alphabetically', () => {
    const rows = [
      makeRow('West Center', '1'),
      makeRow('North Center', '2'),
      makeRow('West Center', '3'),
      makeRow('East Center', '4'),
    ];

    expect(buildCenterOptions(rows)).toEqual([
      { value: ALL_CENTERS_VALUE, label: 'All Centers' },
      { value: 'East Center', label: 'East Center' },
      { value: 'North Center', label: 'North Center' },
      { value: 'West Center', label: 'West Center' },
    ]);
  });
});

describe('filterRowsByCenter', () => {
  it('returns every row for All Centers', () => {
    const rows = [makeRow('North Center', '1'), makeRow('South Center', '2')];

    expect(filterRowsByCenter(rows, ALL_CENTERS_VALUE)).toEqual(rows);
  });

  it('returns only rows matching the selected center', () => {
    const rows = [makeRow('North Center', '1'), makeRow('South Center', '2'), makeRow('North Center', '3')];

    expect(filterRowsByCenter(rows, 'North Center')).toEqual([rows[0], rows[2]]);
  });
});
