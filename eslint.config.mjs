import { getEslintConfig } from "@ezez/eslint";
import { readFile } from "fs/promises";

const packageJson = JSON.parse(String(await readFile("./package.json")));
const react = Boolean(packageJson.libraryTemplate?.jsx);

const config = getEslintConfig({ react });

export default config;
