import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldForSearch, patientSearchText } from './search-folding';

/**
 * Folding, and the migration that has to agree with it.
 *
 * The stored column was backfilled by SQL and is maintained by TypeScript. If
 * the two ever disagree, some patients are findable by one spelling and some by
 * another, with nothing to say which — so the mapping is compared directly.
 */
describe('search folding', () => {
  it('finds a Turkish name typed without its diacritics', () => {
    // The whole point. Before this, "yilmaz" matched nothing.
    expect(foldForSearch('Ayşe Yılmaz')).toBe('ayse yilmaz');
    expect(foldForSearch('Öztürk')).toBe('ozturk');
    expect(foldForSearch('Çağlar')).toBe('caglar');
    expect(foldForSearch('İbrahim')).toBe('ibrahim');
  });

  it('folds the dotless i, which stripping diacritics cannot', () => {
    // U+0131 is its own letter with nothing to decompose, so NFD leaves it
    // alone — which is why this is a table and not normalize().
    expect('ı'.normalize('NFD')).toBe('ı');
    expect(foldForSearch('ı')).toBe('i');
    expect(foldForSearch('ğ')).toBe('g');
  });

  it('lower-cases invariantly, not in Turkish locale', () => {
    // 'I'.toLocaleLowerCase('tr') is 'ı'. An English name in capitals must not
    // take a detour through a letter the fold then has to undo.
    expect(foldForSearch('IAN')).toBe('ian');
    expect(foldForSearch('ian')).toBe('ian');
  });

  it('leaves everything else alone', () => {
    expect(foldForSearch('Müller-Schmidt')).toBe('muller-schmidt');
    expect(foldForSearch('TR-0042')).toBe('tr-0042');
  });

  it('puts name and file number in one string', () => {
    expect(
      patientSearchText({ firstName: 'Ayşe', lastName: 'Yılmaz', mrn: 'TR-0042' }),
    ).toBe('ayse yilmaz tr-0042');
  });

  it('maps exactly the characters the migration maps', () => {
    // The backfill used translate(); this asserts the two tables are the same
    // set and the same targets, so a row written before the migration and a row
    // written after are findable by the same spelling.
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'prisma',
        'migrations',
        '20260905000000_search_folds_turkish',
        'migration.sql',
      ),
      'utf8',
    );

    const match = /translate\(\s*lower\([^)]*\)[^']*'([^']+)',\s*'([^']+)'/s.exec(sql);

    if (!match) {
      throw new Error('The migration no longer contains a translate() to compare against');
    }

    const from = [...(match[1] ?? '')];
    const to = [...(match[2] ?? '')];

    expect(from.length).toBeGreaterThan(0);

    expect(from).toHaveLength(to.length);

    from.forEach((character, index) => {
      expect(foldForSearch(character)).toBe(to[index]);
    });
  });
});
