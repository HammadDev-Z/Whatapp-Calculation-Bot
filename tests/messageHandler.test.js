const { getGroupContext, getSenderIdentity } = require('../src/whatsapp/messageHandler');

describe('messageHandler', () => {
  test('falls back to message.from when getChat fails for group messages', async () => {
    const message = {
      from: '120363428421193897@g.us',
      getChat: jest.fn().mockRejectedValue(new Error('r'))
    };

    const context = await getGroupContext(message);

    expect(context).toEqual({
      id: '120363428421193897@g.us',
      name: '120363428421193897@g.us',
      isGroup: true
    });
  });

  test('ignores private chats without calling getChat', async () => {
    const message = {
      from: '923001234567@c.us',
      getChat: jest.fn()
    };

    await expect(getGroupContext(message)).resolves.toBeNull();
    expect(message.getChat).not.toHaveBeenCalled();
  });

  test('includes lid and contact number as authorization candidates', async () => {
    const message = {
      author: '256577252638929@lid',
      getContact: jest.fn().mockResolvedValue({
        number: '923165057787',
        id: {
          user: '256577252638929',
          _serialized: '256577252638929@lid'
        }
      })
    };

    const identity = await getSenderIdentity(message);

    expect(identity.rawSenderId).toBe('256577252638929@lid');
    expect(identity.values).toContain('256577252638929');
    expect(identity.values).toContain('923165057787');
  });
});
