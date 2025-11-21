import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TaskFunctionContext } from './task-function-context.js';

describe('TaskFunctionContext Integration Tests', () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const context = new TaskFunctionContext(apiUrl);

  it('should create a task successfully', async () => {
    const result = await context.create_task({
      title: 'Integration test task',
    });

    assert.ok(result.includes('Created task'));
    assert.ok(result.includes('Integration test task'));
  });

  it('should get tasks successfully', async () => {
    const result = await context.get_tasks({});

    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('should handle task identifier resolution', async () => {
    // Create a task first
    await context.create_task({
      title: 'Test task for resolution',
    });

    // Try to resolve it by semantic match
    const tasks = await fetch(`${apiUrl}/api/tasks`).then(r => r.json());
    const testTask = tasks.find((t: any) => t.title.includes('Test task for resolution'));

    if (testTask) {
      const result = await context.update_task({
        identifier: 'task for resolution',
        completed: true,
      });

      assert.ok(result.includes('Updated task'));
    }
  });

  it('should handle API errors gracefully', async () => {
    try {
      await context.update_task({
        identifier: 'nonexistent-task-12345',
        completed: true,
      });
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found') || error.message.includes('No tasks match'));
    }
  });
});
