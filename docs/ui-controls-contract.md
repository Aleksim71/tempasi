# Tempasi UI Controls Contract

## Global rule

Tempasi uses one global controls system for tabs, sub-tabs and buttons.
Pages should not create page-specific control styles.

Global CSS file:

```text
public/css/components/ui-controls-contract.css
```

## Main tabs

Use for first-level navigation inside a section.

Examples:

```text
List
Create
Rents
Analytics
```

Classes:

```text
tp-control tp-tab tp-tab--main
```

Visual rule:

```text
Main tabs = yellow outlined
Active main tab = thicker yellow border + yellow underline + bold text
```

## Sub-tabs

Use for second-level navigation inside a card, block or entity.

Examples:

```text
View
Preview
Client preview
Add templates
```

Classes:

```text
tp-control tp-tab tp-tab--sub
```

Visual rule:

```text
Sub-tabs = green outlined
```

## Buttons

Buttons are actions, not navigation.

Secondary action example:

```text
Clear
```

Classes:

```text
tp-control tp-button tp-button--secondary
```

Destructive action example:

```text
Delete
```

Classes:

```text
tp-control tp-button tp-button--danger
```

## Summary

```text
Main tabs        → yellow outlined
Active main tab  → thicker yellow border + underline
Sub-tabs         → green outlined
Secondary action → yellow outlined
Danger action    → danger outlined / danger tinted
```
