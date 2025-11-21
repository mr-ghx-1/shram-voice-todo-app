# Natural Language Date Parsing

The voice assistant supports natural language date expressions when creating or updating tasks. This allows users to speak naturally without needing to specify exact dates and times.

## Supported Date Formats

### Relative Dates

- **"today"** - Sets the task for today at noon (12:00 PM)
- **"tonight"** - Sets the task for today at 8:00 PM
- **"tomorrow"** - Sets the task for tomorrow at noon

### Relative Time Periods

- **"in X days"** - Example: "in 3 days", "in 1 day"
- **"in X weeks"** - Example: "in 2 weeks", "in 1 week"
- **"in X months"** - Example: "in 1 month", "in 6 months"
- **"next week"** - Sets the task for 7 days from now
- **"next month"** - Sets the task for 1 month from now

### Weekday Names

- **"Monday"**, **"Tuesday"**, **"Wednesday"**, etc. - Next occurrence of that weekday
- **"next Monday"**, **"next Friday"**, etc. - Explicitly next week's occurrence
- **"this Friday"** - Next occurrence of Friday (same as just "Friday")

### ISO 8601 Dates

You can also use standard ISO 8601 datetime strings:
- **"2024-12-25T10:00:00Z"** - Specific date and time in UTC

## Usage Examples

### Creating Tasks with Dates

```
User: "Create a task to review the report tomorrow"
Assistant: "Created task: review the report scheduled for tomorrow"

User: "Make me a task to call the client next Monday"
Assistant: "Created task: call the client scheduled for Monday, January 22"

User: "I want to work on the presentation in 3 days"
Assistant: "Created task: work on the presentation scheduled for Thursday, January 18"
```

### Updating Task Dates

```
User: "Push the task about fixing bugs to tomorrow"
Assistant: "Updated task: fixing bugs. rescheduled to tomorrow"

User: "Reschedule the 4th task to next week"
Assistant: "Updated task: [task title]. rescheduled to Monday, January 22"

User: "Move the meeting task to Friday"
Assistant: "Updated task: meeting. rescheduled to Friday, January 19"
```

## Timezone Handling

All dates are stored in UTC (Coordinated Universal Time) in the database. The date parser uses UTC for all calculations to ensure consistency across different timezones.

When displaying dates back to users, the system formats them in a user-friendly way:
- "today" for dates on the current day
- "tomorrow" for dates on the next day
- Full date format (e.g., "Monday, January 22") for other dates

## Past Date Validation

The system automatically validates that scheduled dates are not in the past. If a user tries to schedule a task for a past date, they will receive a friendly error message:

```
"Cannot schedule tasks in the past. Please choose a future date."
```

## Error Handling

If the system cannot understand a date expression, it will provide a helpful error message:

```
"I couldn't understand the date '[expression]'. Try phrases like 'tomorrow', 'next Monday', 'in 3 days', or a specific date."
```

## Implementation Details

The natural language date parsing is implemented in `src/date-parser.ts` and integrated into the `create_task` and `update_task` functions in `src/task-function-context.ts`.

The parser:
1. Normalizes input to lowercase for case-insensitive matching
2. Checks for ISO 8601 format first (pass-through)
3. Matches against known patterns (today, tomorrow, weekdays, etc.)
4. Calculates the target date based on the current reference date
5. Validates the date is not in the past
6. Returns an ISO 8601 datetime string for storage

## Testing

The date parser includes comprehensive unit tests in `src/date-parser.test.ts` that verify:
- Correct parsing of all supported date formats
- Proper timezone handling (UTC)
- Past date validation
- Error handling for invalid expressions
- Case-insensitive input handling

Run the tests with:
```bash
npm test src/date-parser.test.ts
```
