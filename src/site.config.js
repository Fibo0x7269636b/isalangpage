// Values that differ per deployment. In GitHub Actions, GITHUB_REPOSITORY is
// set automatically; ISALANG_COMPILER_REPO can point to the compiler sources
// when they live in a separate repository.
const env = typeof process !== 'undefined' ? process.env : {};

export const SITE = {
  name: 'Isalang',
  description: 'Linguagem experimental de programação de sistemas com ownership, typestate e verificação estática de recursos. Compilador Isac com backend MLIR/LLVM.',
  // owner/name of this site's repository (documentation sources live here)
  repo: env.GITHUB_REPOSITORY || env.ISALANG_SITE_REPO || 'isa-language/isalang',
  branch: env.ISALANG_DOCS_BRANCH || 'main',
  docsDir: 'src/content/docs',
  // owner/name of the compiler repository
  compilerRepo: env.ISALANG_COMPILER_REPO || 'isa-language/isalang',
};

export const githubUrl = (repo = SITE.repo) => `https://github.com/${repo}`;
