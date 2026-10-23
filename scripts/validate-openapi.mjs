import SwaggerParser from '@apidevtools/swagger-parser';

for (const file of process.argv.slice(2)) {
  await SwaggerParser.validate(file);
  console.log(`OpenAPI valid: ${file}`);
}
