import { PORT } from './utils/constants.ts';

const server = (await import('./server.ts')).default;

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
