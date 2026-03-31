# AIQA MVP

Enterprise AI QA Platform — Minimal Working MVP. This platform allows you to run automated tests using Playwright and YAML configurations.

## Prerequisites

- Node.js (v18 or higher recommended)
- `npm` (comes with Node.js)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mutukulamahesh/aiqa-mvp.git
   cd aiqa-mvp
   ```

2. Install the dependencies:
   ```bash
   npm install
   ```

3. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

## Usage

### Development

To run the CLI interface locally:
```bash
npm run dev
```

### Running Tests

You can run your customized tests using the CLI. For example, to run an example test (if you have one setup in `tests/example.yaml`):

```bash
npm run run:test -- tests/example.yaml
```

### Building for Production

Compile TypeScript locally for production use:
```bash
npm run build
```

## Technologies Used

* [TypeScript](https://www.typescriptlang.org/)
* [Playwright](https://playwright.dev/) for Web Automation
* [js-yaml](https://github.com/nodeca/js-yaml) for parsing test workflows
* [Commander.js](https://github.com/tj/commander.js) for the CLI interface

## License
MIT
