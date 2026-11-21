import levelsJson from "@/content/levels/levels.json";
import roleLevelsJson from "@/content/levels/role-levels.json";
import { levelsFile, roleLevelsFile } from "@/lib/schemas/levels";

/** The eight levels and the title picker's titles (drafts until an expert signs them off). Checked at import. */
export const levels = levelsFile.parse(levelsJson);

/** The level of every role profile, by slug (a test checks it covers every role and nothing else). */
export const roleLevels = roleLevelsFile.parse(roleLevelsJson).roles;
