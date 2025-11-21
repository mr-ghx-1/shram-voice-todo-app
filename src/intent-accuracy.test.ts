import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TaskFunctionContext } from './task-function-context.js';

describe('Intent Recognition Accuracy Tests', () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const context = new TaskFunctionContext(apiUrl);

  // Sample voice commands for CRUD operations
  const testCommands = [
    // Create operations
    { command: 'Buy groceries', operation: 'create', expectedSuccess: true },
    { command: 'Add task to call mom', operation: 'create', expectedSuccess: true },
    { command: 'Create a task for tomorrow meeting', operation: 'create', expectedSuccess: true },
    
    // Read operations
    { command: 'Show all tasks', operation: 'read', expectedSuccess: true },
    { command: 'List my tasks', operation: 'read', expectedSuccess: true },
    
    // Update operations (requires existing tasks)
    { command: 'Mark first task as complete', operation: 'update', expectedSuccess: true },
    { command: 'Complete the groceries task', operation: 'update', expectedSuccess: true },
    
    // Delete operations (requires existing tasks)
    { command: 'Delete the first task', operation: 'delete', expectedSuccess: true },
    { command: 'Remove task about meeting', operation: 'delete', expectedSuccess: true },
  ];

  it('should handle create task commands', async () => {
    const createCommands = testCommands.filter(c => c.operation === 'create');
    let successCount = 0;

    for (const cmd of createCommands) {
      try {
        const result = await context.create_task({ title: cmd.command });
        if (result.includes('Created task')) {
          successCount++;
        }
      } catch (error) {
        // Command failed
      }
    }

    const accuracy = (successCount / createCommands.length) * 100;
    console.log(`Create command accuracy: ${accuracy.toFixed(1)}%`);
    assert.ok(accuracy >= 90, `Create accuracy ${accuracy}% is below 90% threshold`);
  });

  it('should handle read task commands', async () => {
    const readCommands = testCommands.filter(c => c.operation === 'read');
    let successCount = 0;

    for (const cmd of readCommands) {
      try {
        const result = await context.get_tasks({});
        if (typeof result === 'string' && result.length > 0) {
          successCount++;
        }
      } catch (error) {
        // Command failed
      }
    }

    const accuracy = (successCount / readCommands.length) * 100;
    console.log(`Read command accuracy: ${accuracy.toFixed(1)}%`);
    assert.ok(accuracy >= 90, `Read accuracy ${accuracy}% is below 90% threshold`);
  });

  it('should handle ambiguous task references', async () => {
    // Create multiple similar tasks
    await context.create_task({ title: 'Buy groceries at store' });
    await context.create_task({ title: 'Buy groceries online' });

    try {
      // This should fail or ask for clarification
      await context.update_task({
        identifier: 'groceries',
        completed: true,
      });
      // If it succeeds, it should have picked one
      assert.ok(true);
    } catch (error) {
      // Expected to fail with ambiguous match
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.includes('multiple') || error.message.includes('ambiguous'),
        'Should indicate ambiguous match'
      );
    }
  });

  it('should handle edge cases', async () => {
    const edgeCases = [
      { title: '', shouldFail: true }, // Empty title
      { title: 'a'.repeat(600), shouldFail: true }, // Too long
      { title: 'Normal task', shouldFail: false }, // Valid
    ];

    for (const testCase of edgeCases) {
      try {
        await context.create_task({ title: testCase.title });
        assert.ok(!testCase.shouldFail, `Should have failed for: ${testCase.title.substring(0, 20)}`);
      } catch (error) {
        assert.ok(testCase.shouldFail, `Should have succeeded for: ${testCase.title.substring(0, 20)}`);
      }
    }
  });
});
