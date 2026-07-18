# Product

## Register

product

## Users

Security and operations engineers who maintain dddd capability libraries locally. They work with large fingerprint, directory-path, workflow, and POC collections and need to review changes before writing them into a project.

## Product Purpose

Doperationtool is a desktop operations console for auditing and governing the dddd recognition chain. It helps users inspect `finger.yaml`, `dir.yaml`, `workflow.yaml`, and `common/config/pocs`, review external capability candidates, compare them with an existing project, apply approved changes, and retain a recovery path.

Success means an operator can understand the impact of a capability change, approve only the intended items, and recover from an incorrect write without leaving the project in an ambiguous state.

## Brand Personality

Professional, restrained, and information-dense. The interface should feel trustworthy under repetitive maintenance work: direct language, predictable controls, visible progress, and explicit confirmation before destructive or write operations.

## Anti-references

Avoid marketing-style landing page composition, oversized hero typography, decorative card grids, gratuitous animation, glassmorphism, and controls that hide important operational state behind visual flourish. Do not trade scanability or recovery clarity for novelty.

## Design Principles

- Make the recognition chain legible: show how an input, product, workflow, and POC relate.
- Preview before mutation: write actions expose scope, counts, and confirmation requirements first.
- Preserve operator control: long tasks are cancellable, selections are explicit, and recovery is discoverable.
- Favor dense clarity: support comparison and repeated review without visual noise.
- Keep behavior consistent: shared controls, states, and terminology should work the same across modules.

## Accessibility & Inclusion

Target WCAG 2.1 AA for the desktop web surface. Preserve keyboard access, visible focus states, semantic labels, sufficient color contrast, and non-color status cues. Respect `prefers-reduced-motion` and ensure progress, errors, empty states, and confirmation requirements are understandable without relying on animation or color alone.
