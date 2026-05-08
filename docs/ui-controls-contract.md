# Tempasi UI Controls Contract

## Purpose

This document fixes the visual contract for tabs, sub-tabs, and action buttons in Tempasi.

The goal is to make interactive elements visually consistent and immediately understandable across Cabinet spaces: Cases, My Templates, Finance, Profile & Security, and Support.

---

## Control hierarchy

### Main tabs

Main tabs are the first navigation level inside a page or Cabinet space.

Examples:

- List
- Create
- Rents
- Analytics

Contract:

- shape: rounded rectangle;
- background: dark;
- border: yellow/gold;
- text: light;
- active state: stronger yellow/gold border and subtle dark highlight;
- use only for primary navigation inside the current page.

Meaning:

```text
Yellow outlined control = main tab / primary local navigation.
```

---

### Sub-tabs

Sub-tabs are the second navigation level inside an item, case, template, or local card.

Examples:

- View
- Preview
- Client preview
- Add templates

Contract:

- shape: rounded rectangle;
- background: dark;
- border: green;
- text: light;
- active/hover state: stronger green border and subtle dark highlight;
- may be slightly more compact than main tabs, but must use the same radius and border-width system.

Meaning:

```text
Green outlined control = sub-tab / secondary navigation.
```

---

### Action buttons

Buttons execute actions. They are not tabs.

Examples:

- Clear
- Delete
- Save
- Create
- Complete demo checkout

Contract:

- primary action: yellow filled button with dark text;
- positive/confirm action: green filled button with dark text;
- destructive action: separate danger style, not yellow and not green;
- secondary action: neutral dark button.

Meaning:

```text
Filled control = action.
Outlined control = navigation.
```

---

## Color semantics

```text
Main tabs      -> yellow outlined
Sub-tabs       -> green outlined
Primary action -> yellow filled
Confirm action -> green filled
Danger action  -> destructive / neutral-danger style
```

---

## Consistency rules

1. Main tabs, sub-tabs, and buttons must use the same border-radius system.
2. Main tabs and sub-tabs must use the same border-width system.
3. Do not use filled styles for navigation tabs.
4. Do not use outlined tab styles for destructive actions.
5. Do not duplicate section title text when the active Cabinet space already communicates the location.

---

## Current Cases cleanup rule

In the Cases Cabinet space, the duplicated top `Cases` page title should be removed when the left Cabinet navigation already highlights `Cases`.

The local tab row should become the primary visible control group:

```text
List | Create | Rents | Analytics
```

Case-level links should be styled as sub-tabs:

```text
View | Preview | Client preview | Add templates
```

Case-level actions should remain buttons:

```text
Clear | Delete
```
