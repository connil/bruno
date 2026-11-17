import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { collectionsSlice } from 'providers/ReduxStore/slices/collections';
import themes from 'themes';
import QueryParams from './index';

jest.mock('providers/Theme', () => ({ useTheme: () => ({ storedTheme: 'light' }) }));
jest.mock('hooks/usePersistedState', () => ({ usePersistedState: ({ default: value }) => [value, jest.fn()] }));
jest.mock('hooks/useTrackScroll', () => ({ useTrackScroll: jest.fn() }));
jest.mock('components/MultiLineEditor', () => () => null);
jest.mock('../../BulkEditor', () => () => null);
jest.mock('components/EditableTable', () => ({ columns, rows }) => (
  <table>
    <thead><tr>{columns.map((column) => <th key={column.key}>{column.name}</th>)}</tr></thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.uid}>
          {columns.map((column) => (
            <td key={column.key}>
              {column.render ? column.render({ row, value: row[column.key], isLastEmptyRow: false }) : row[column.key]}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
));

describe('query parameter encoding controls', () => {
  it('groups the controls and retains their values after saving the draft', () => {
    const item = {
      uid: 'request',
      type: 'http-request',
      request: {
        url: 'https://example.com?token=hello',
        params: [{ uid: 'param', name: 'token', value: 'hello', type: 'query', enabled: true }]
      }
    };
    const store = configureStore({
      reducer: { collections: collectionsSlice.reducer, tabs: (state = { tabs: [], activeTabUid: null }) => state },
      preloadedState: { collections: { collections: [{ uid: 'collection', items: [item] }] } }
    });
    const ConnectedQueryParams = () => {
      const collection = useSelector((state) => state.collections.collections[0]);
      return <QueryParams collection={collection} item={collection.items[0]} />;
    };

    render(
      <Provider store={store}>
        <ThemeProvider theme={themes.light}>
          <ConnectedQueryParams />
        </ThemeProvider>
      </Provider>
    );

    expect(screen.getByText('Encode')).toBeInTheDocument();
    const name = screen.getByRole('checkbox', { name: 'URL-encode name for token' });
    const value = screen.getByRole('checkbox', { name: 'URL-encode value for token' });
    const base64 = screen.getByRole('checkbox', { name: 'Base64-encode value for token' });
    expect(within(base64.closest('td')).getAllByRole('checkbox')).toHaveLength(3);
    expect(name).toHaveAttribute('title', 'URL-encode name');
    expect(value).toHaveAttribute('title', 'URL-encode value');
    expect(base64).toHaveAttribute('title', 'Base64-encode value');
    expect(name).toBeChecked();
    expect(value).toBeChecked();
    expect(base64).not.toBeChecked();

    fireEvent.click(name);
    fireEvent.click(base64);
    expect(name).not.toBeChecked();
    expect(base64).toBeChecked();

    fireEvent.click(value);
    expect(base64).toBeChecked();
    expect(value).not.toBeChecked();

    act(() => {
      store.dispatch(collectionsSlice.actions.saveRequest({ collectionUid: 'collection', itemUid: 'request' }));
    });
    expect(base64).toBeChecked();
    expect(name).not.toBeChecked();
    expect(value).not.toBeChecked();
  });
});
