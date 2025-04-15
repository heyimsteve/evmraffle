# Contributing to EVM Raffle

Thank you for your interest in contributing to EVM Raffle! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Branching Strategy](#branching-strategy)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Add the original repository as a remote named "upstream"
4. Create a new branch for your feature or bug fix
5. Make your changes
6. Push your branch to your fork
7. Submit a pull request from your branch to the main repository

## Development Environment

1. Ensure you have Node.js (v18 or higher) and npm (v8 or higher) installed
2. Install dependencies: `npm install`
3. Create a `.env` file with the necessary environment variables (see README.md)
4. Start the development server: `npm run dev`

## Branching Strategy

- `main`: Production-ready code
- `develop`: Development branch, contains code for the next release
- `feature/*`: New features or enhancements
- `bugfix/*`: Bug fixes
- `hotfix/*`: Urgent fixes for production issues
- `release/*`: Release preparation branches

## Commit Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `test`: Adding or correcting tests
- `chore`: Changes to the build process, tools, etc.

Example: `feat(agents): add ability to customize agent avatars`

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update the documentation if necessary
3. The PR should work in all supported browsers and devices
4. Ensure all tests pass
5. Get at least one code review from a maintainer
6. Once approved, a maintainer will merge your PR

## Coding Standards

- Follow the existing code style
- Use TypeScript for type safety
- Use React hooks for state management
- Follow the feature-based folder structure
- Use Tailwind CSS for styling
- Use Lucide React for icons

## Testing

- Write tests for new features and bug fixes
- Ensure all existing tests pass before submitting a PR
- Test your changes in different browsers and screen sizes

## Documentation

- Update documentation for any changed functionality
- Document new features, components, and APIs
- Use JSDoc comments for functions and components
- Keep the README.md up to date

## Issue Reporting

When reporting issues, please include:

1. A clear and descriptive title
2. Steps to reproduce the issue
3. Expected behavior
4. Actual behavior
5. Screenshots if applicable
6. Environment details (browser, OS, etc.)
7. Any additional context

## Feature Requests

Feature requests are welcome! Please provide:

1. A clear and descriptive title
2. A detailed description of the proposed feature
3. Any relevant examples, mockups, or use cases
4. Why this feature would be beneficial to the project

Thank you for contributing to EVM Raffle!