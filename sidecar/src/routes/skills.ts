/**
 * Skills HTTP routes — list, install, search skills
 */

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import os from 'os';

const skillsRoutes = new Hono();

/** Skills directories */
function getSkillsDirs(): string[] {
  return [
    path.join(os.homedir(), '.claude', 'commands'),
    path.join(os.homedir(), '.miniclaw', 'skills'),
  ];
}

interface SkillEntry {
  name: string;
  description: string;
  source: string;
  path: string;
}

function scanSkills(): SkillEntry[] {
  const skills: SkillEntry[] = [];
  for (const dir of getSkillsDirs()) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (entry.endsWith('.md')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const firstLine = content.split('\n')[0]?.replace(/^#+\s*/, '') || entry;
          skills.push({
            name: entry.replace('.md', ''),
            description: firstLine.slice(0, 100),
            source: dir.includes('.claude') ? 'claude' : 'miniclaw',
            path: fullPath,
          });
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return skills;
}

/** GET /skills — List available skills */
skillsRoutes.get('/', (c) => {
  return c.json({ skills: scanSkills() });
});

/** GET /skills/:name — Get skill content */
skillsRoutes.get('/:name', (c) => {
  const name = c.req.param('name');
  const skills = scanSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404);
  }
  const content = fs.readFileSync(skill.path, 'utf-8');
  return c.json({ ...skill, content });
});

export default skillsRoutes;
