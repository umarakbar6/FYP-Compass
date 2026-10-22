export interface RosterPerson {
  email: string;
  full_name: string;
  role: 'student' | 'supervisor' | 'examiner';
  group_name?: string;
}
export function parseRoster(csv: string): RosterPerson[] {
  if (csv.length > 65536) throw Error('Roster must be smaller than 64 KB.');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.trim());
      field = '';
      if (c === '\n') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== '\r') field += c;
  }
  if (quoted) throw Error('A CSV quoted field is not closed.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const header = rows
    .shift()
    ?.map((x) => x.toLowerCase())
    .join(',');
  if (!['email,full_name,role', 'email,full_name,role,group_name'].includes(header || ''))
    throw Error('Use email,full_name,role and optional group_name as the CSV header.');
  const grouped = header === 'email,full_name,role,group_name';
  if (!rows.length || rows.length > 20) throw Error('Preview 1 to 20 accounts at a time.');
  const emails = new Set<string>();
  const parsed = rows.map((r, i) => {
    const email = (r[0] || '').toLowerCase(),
      full_name = r[1] || '',
      role = r[2]?.toLowerCase();
    if (
      r.length !== (grouped ? 4 : 3) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      full_name.length < 2 ||
      full_name.length > 120 ||
      !['student', 'supervisor', 'examiner'].includes(role)
    )
      throw Error('Check CSV row ' + (i + 2) + ': email, name and allowed role required.');
    if (emails.has(email)) throw Error('Duplicate email in CSV row ' + (i + 2));
    emails.add(email);
    const group_name = r[3] || '';
    if (group_name && (role !== 'student' || group_name.length > 120))
      throw Error('Only students may have a proposed group (maximum 120 characters).');
    return {
      email,
      full_name,
      role: role as RosterPerson['role'],
      ...(group_name ? { group_name } : {}),
    };
  });
  const groups = new Map<string, number>();
  for (const person of parsed)
    if (person.group_name) {
      const size = (groups.get(person.group_name) || 0) + 1;
      if (size > 3) throw Error('A proposed group may contain at most three students.');
      groups.set(person.group_name, size);
    }
  return parsed;
}
export function proposedGroups(people: RosterPerson[]) {
  const groups = new Map<string, string[]>();
  for (const p of people)
    if (p.group_name) groups.set(p.group_name, [...(groups.get(p.group_name) || []), p.email]);
  return [...groups].map(([name, members]) => ({ name, members }));
}
