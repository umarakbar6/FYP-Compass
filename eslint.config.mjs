
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
 {ignores:['dist/**','node_modules/**','backend/local-tests/**','handover/**','.private/**']},
 ...tseslint.configs.recommended,
 {files:['src/**/*.{ts,tsx}','backend/agents/*.ts'],languageOptions:{globals:{...globals.browser,...globals.node,vi:'readonly',it:'readonly',expect:'readonly',describe:'readonly',beforeEach:'readonly',afterEach:'readonly'}},
 rules:{'@typescript-eslint/no-explicit-any':'warn','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_'}],'@typescript-eslint/no-unused-expressions':['error',{allowShortCircuit:true,allowTernary:true}],'no-console':'off'}}
);
