---
description: Architecture rules for server-side code
paths:
  - 'src/server/**'
  - 'packages/core/**'
---

# Architecture Rules

Always delegate business logic to the service layer.
Never call the database directly from controllers.
Use dependency injection for all external services.
