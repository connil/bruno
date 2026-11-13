import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { ThemeContext } from 'providers/Theme';
import { appSlice } from 'providers/ReduxStore/slices/app';
import themes from 'themes';
import toast from 'react-hot-toast';
import General from './index';

jest.mock('providers/ReduxStore/slices/collections/actions', () => ({
  browseDirectory: jest.fn()
}));
jest.mock('react-hot-toast', () => ({ error: jest.fn() }));

const mockInvoke = jest.fn();
const originalIpcRenderer = window.ipcRenderer;

const renderPreferences = (userAgent = '') => {
  const initialState = appSlice.reducer(undefined, { type: 'init' });
  const store = configureStore({
    reducer: { app: appSlice.reducer },
    preloadedState: {
      app: {
        ...initialState,
        preferences: {
          ...initialState.preferences,
          request: { ...initialState.preferences.request, userAgent }
        }
      }
    }
  });
  const component = (
    <Provider store={store}>
      <ThemeContext.Provider value={{ theme: themes.light }}>
        <ThemeProvider theme={themes.light}>
          <General />
        </ThemeProvider>
      </ThemeContext.Provider>
    </Provider>
  );
  return { ...render(component), component };
};

describe('global User-Agent setting', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    window.ipcRenderer = { invoke: mockInvoke };
  });

  afterEach(() => {
    window.ipcRenderer = originalIpcRenderer;
  });

  it('saves the custom value and shows it when preferences are reopened', async () => {
    const { component, unmount } = renderPreferences();
    fireEvent.change(screen.getByLabelText('User-Agent'), { target: { value: 'MyClient/1.0' } });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'renderer:save-preferences',
      expect.objectContaining({ request: expect.objectContaining({ userAgent: 'MyClient/1.0' }) })
    ));

    unmount();
    render(component);
    expect(screen.getByLabelText('User-Agent')).toHaveValue('MyClient/1.0');
  });

  it('saves an empty value to restore built-in defaults', async () => {
    renderPreferences('MyClient/1.0');
    fireEvent.change(screen.getByLabelText('User-Agent'), { target: { value: '' } });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
      'renderer:save-preferences',
      expect.objectContaining({ request: expect.objectContaining({ userAgent: '' }) })
    ));
  });

  it('shows invalid header input without saving it', async () => {
    renderPreferences();
    const input = screen.getByLabelText('User-Agent');
    fireEvent.change(input, { target: { value: 'Client/\u0100' } });
    fireEvent.blur(input);

    expect(await screen.findByText('User-Agent contains invalid HTTP header characters')).toBeVisible();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('notifies the user if the preference cannot be saved', async () => {
    mockInvoke.mockRejectedValue(new Error('Cannot save preferences'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPreferences();
      fireEvent.change(screen.getByLabelText('User-Agent'), { target: { value: 'MyClient/1.0' } });
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update preferences'));
    } finally {
      consoleError.mockRestore();
    }
  });
});
