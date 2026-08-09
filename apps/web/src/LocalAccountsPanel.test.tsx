import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAccountsPanel } from "./LocalAccountsPanel";
import type { WorkspaceUser } from "./types";

const adminUser: WorkspaceUser = {
  id: "user-1",
  email: "admin@tavi.local",
  name: "Admin",
  role: "admin",
};

const editorUser: WorkspaceUser = {
  id: "user-2",
  email: "editor@tavi.local",
  name: "Editor",
  role: "editor",
};

function createResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createAccountRecord(
  id: string,
  email: string,
  name: string,
  role: "admin" | "editor" | "viewer",
  counts?: {
    assignedTaskCount?: number;
    ownedProjectCount?: number;
  },
) {
  return {
    id,
    email,
    name,
    role,
    ...(counts?.assignedTaskCount !== undefined
      ? { assignedTaskCount: counts.assignedTaskCount }
      : {}),
    ...(counts?.ownedProjectCount !== undefined
      ? { ownedProjectCount: counts.ownedProjectCount }
      : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderPanel(currentUser: WorkspaceUser, isAdmin: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const onNotice = vi.fn();
  const onClose = vi.fn();

  return {
    onClose,
    onNotice,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LocalAccountsPanel
          currentUser={currentUser}
          isAdmin={isAdmin}
          onClose={onClose}
          onNotice={onNotice}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("LocalAccountsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("filters local accounts live for admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createResponse({
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
            createAccountRecord(
              "user-2",
              "viewer@tavi.local",
              "Viewer",
              "viewer",
            ),
          ],
        }),
      ),
    );

    renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Filter by name, email, or role"), {
      target: { value: "viewer" },
    });

    expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    expect(screen.queryByText("admin@tavi.local")).not.toBeInTheDocument();
  });

  it("exposes a close button for the panel header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createResponse({
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
          ],
        }),
      ),
    );

    const { onClose } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("edits local accounts inline within the selected row", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "viewer.one@tavi.local",
          "Viewer One",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/user-2") && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({
            email: "viewer.updated@tavi.local",
            name: "Viewer Updated",
            role: "editor",
          }),
        );

        listResponse = {
          accounts: [
            listResponse.accounts[0],
            createAccountRecord(
              "user-2",
              "viewer.updated@tavi.local",
              "Viewer Updated",
              "editor",
            ),
          ],
        };

        return createResponse({
          account: listResponse.accounts[1],
          notificationEmailSent: true,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
    });

    const accountRow = screen
      .getByText("viewer.one@tavi.local")
      .closest("li") as HTMLLIElement | null;

    expect(accountRow).not.toBeNull();

    fireEvent.click(within(accountRow!).getByRole("button", { name: "Edit" }));

    fireEvent.change(within(accountRow!).getByDisplayValue("Viewer One"), {
      target: { value: "Viewer Updated" },
    });
    fireEvent.change(within(accountRow!).getByDisplayValue("viewer.one@tavi.local"), {
      target: { value: "viewer.updated@tavi.local" },
    });
    fireEvent.change(within(accountRow!).getByDisplayValue("Viewer"), {
      target: { value: "editor" },
    });
    fireEvent.click(within(accountRow!).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("viewer.updated@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("Viewer Updated")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Updated local account for Viewer Updated and sending notification email.",
    );
  });

  it("offers reassignment or None when removing accounts with assigned tasks", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "viewer.one@tavi.local",
          "Viewer One",
          "viewer",
          { assignedTaskCount: 2 },
        ),
        createAccountRecord(
          "user-3",
          "viewer.two@tavi.local",
          "Viewer Two",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/user-2") && init?.method === "DELETE") {
        expect(init.body).toBe(
          JSON.stringify({
            nextTaskAssigneeUserId: "user-3",
          }),
        );

        listResponse = {
          accounts: [listResponse.accounts[0], listResponse.accounts[2]],
        };

        return createResponse({ id: "user-2" });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
    });

    const accountRow = screen
      .getByText("viewer.one@tavi.local")
      .closest("li") as HTMLLIElement | null;

    expect(accountRow).not.toBeNull();

    fireEvent.click(within(accountRow!).getByRole("button", { name: "Remove" }));

    expect(
      within(accountRow!).getByText(
        "Reassign or remove related data before deleting this account: assigned tasks",
      ),
    ).toBeInTheDocument();
    expect(
      within(accountRow!).getByRole("option", { name: "Viewer Two" }),
    ).toBeInTheDocument();
    expect(
      within(accountRow!).getByRole("option", { name: "None" }),
    ).toBeInTheDocument();

    fireEvent.change(
      within(accountRow!).getByLabelText("Assigned tasks for Viewer One"),
      {
        target: { value: "user-3" },
      },
    );
    fireEvent.click(
      within(accountRow!).getByRole("button", { name: "Remove Account" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("viewer.one@tavi.local")).not.toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith("Removed local account.");
  });

  it("offers replacement options for owned projects and assigned tasks before deleting an account", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "editor@tavi.local",
          "Default Editor",
          "editor",
          { ownedProjectCount: 1, assignedTaskCount: 2 },
        ),
        createAccountRecord(
          "user-3",
          "viewer.two@tavi.local",
          "Viewer Two",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/user-2") && init?.method === "DELETE") {
        expect(init.body).toBe(
          JSON.stringify({
            nextProjectOwnerUserId: "user-3",
            nextTaskAssigneeUserId: "user-3",
          }),
        );

        listResponse = {
          accounts: [listResponse.accounts[0], listResponse.accounts[2]],
        };

        return createResponse({ id: "user-2" });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
    });

    const accountRow = screen
      .getByText("editor@tavi.local")
      .closest("li") as HTMLLIElement | null;

    expect(accountRow).not.toBeNull();

    fireEvent.click(within(accountRow!).getByRole("button", { name: "Remove" }));

    expect(
      within(accountRow!).getByText(
        "Reassign or remove related data before deleting this account: owned projects, assigned tasks",
      ),
    ).toBeInTheDocument();
    expect(
      within(accountRow!).getByLabelText("Owned projects for Default Editor"),
    ).toBeInTheDocument();
    expect(
      within(accountRow!).getByLabelText("Assigned tasks for Default Editor"),
    ).toBeInTheDocument();
    expect(
      within(accountRow!).getAllByRole("option", { name: "Viewer Two" }),
    ).toHaveLength(2);
    expect(
      within(accountRow!).getAllByRole("option", { name: "None" }),
    ).toHaveLength(2);

    fireEvent.change(
      within(accountRow!).getByLabelText("Owned projects for Default Editor"),
      {
        target: { value: "user-3" },
      },
    );
    fireEvent.change(
      within(accountRow!).getByLabelText("Assigned tasks for Default Editor"),
      {
        target: { value: "user-3" },
      },
    );
    fireEvent.click(
      within(accountRow!).getByRole("button", { name: "Remove Account" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("editor@tavi.local")).not.toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith("Removed local account.");
  });

  it("generates a password for new local accounts", async () => {
    let generatedPassword = "";
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as {
          email: string;
          name: string;
          password: string;
          role: "admin" | "editor" | "viewer";
        };

        expect(payload).toMatchObject({
          email: "generated.user@tavi.local",
          name: "Generated User",
          role: "viewer",
        });
        expect(payload.password).toBe(generatedPassword);
        expect(payload.password).toMatch(/^[A-Za-z0-9]{20}$/);

        const createdAccount = createAccountRecord(
          "user-2",
          payload.email,
          payload.name,
          payload.role,
        );
        listResponse = {
          accounts: [...listResponse.accounts, createdAccount],
        };

        return createResponse({ account: createdAccount });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Account" }));
    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Generated User" },
    });
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "generated.user@tavi.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    const passwordInput = screen.getByPlaceholderText("Password") as HTMLInputElement;
    generatedPassword = passwordInput.value;

    expect(generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("generated.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Created local account for Generated User.",
    );
  });

  it("generates a password in the set password panel", async () => {
    let generatedPassword = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse({
          accounts: [
            createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
            createAccountRecord(
              "user-2",
              "viewer.one@tavi.local",
              "Viewer One",
              "viewer",
            ),
          ],
        });
      }

      if (url.endsWith("/auth/accounts/user-2/password") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ password: generatedPassword }));
        expect(generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);
        return createResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
    });

    const accountRow = screen
      .getByText("viewer.one@tavi.local")
      .closest("li") as HTMLLIElement | null;

    expect(accountRow).not.toBeNull();

    fireEvent.click(within(accountRow!).getByRole("button", { name: "Set Password" }));

    const passwordDialog = within(accountRow!).getByRole("dialog", {
      name: "Set password · Viewer One",
    });
    const passwordForm = within(passwordDialog)
      .getByPlaceholderText("New password")
      .closest("form") as HTMLFormElement | null;

    expect(passwordForm).not.toBeNull();

    const nextPasswordInput = within(passwordForm!).getByPlaceholderText(
      "New password",
    ) as HTMLInputElement;
    const confirmPasswordInput = within(passwordForm!).getByPlaceholderText(
      "Confirm password",
    ) as HTMLInputElement;

    fireEvent.click(within(passwordDialog).getByRole("button", { name: "Generate" }));

    generatedPassword = nextPasswordInput.value;

    expect(generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(confirmPasswordInput.value).toBe(generatedPassword);

    fireEvent.click(
      within(passwordDialog).getByRole("button", { name: "Set Password" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2/password",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    expect(onNotice).toHaveBeenCalledWith("Set password for Viewer One.");
  });

  it("lets non-admins set only their own password", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            currentPassword: "currentpassword123",
            password: "newpassword123",
          }),
        );
        return createResponse({ success: true });
      }

      throw new Error("Unexpected fetch");
    });

    vi.stubGlobal("fetch", fetchMock);

    renderPanel(editorUser, false);

    fireEvent.change(screen.getByPlaceholderText("Current password"), {
      target: { value: "currentpassword123" },
    });
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Password" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/me/password",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  it("exports local accounts as JSON for admins", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts")) {
        return createResponse({
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
          ],
        });
      }

      if (url.endsWith("/auth/accounts/export")) {
        return createResponse({
          accounts: [
            {
              email: "admin@tavi.local",
              name: "Admin",
              passwordHash:
                "$2b$10$abcdefghijklmnopqrstuuC6f4Wj1F0m1YJmQxvQhW2i5Y6nZ9e6",
              role: "admin",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    const createObjectURL = vi.fn(() => "blob:local-accounts");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/export",
        expect.objectContaining({
          credentials: "include",
        }),
      );
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith("Downloaded 1 local account as JSON.");
  });

  it("imports local accounts from JSON for admins", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/import") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            accounts: [
              {
                email: "new.user@tavi.local",
                name: "New User",
                password: "new-password-123",
                role: "editor",
              },
            ],
          }),
        );

        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "user-2",
              "new.user@tavi.local",
              "New User",
              "editor",
            ),
          ],
        };

        return createResponse({
          accounts: listResponse.accounts,
          summary: {
            processed: 1,
            created: 1,
            updated: 0,
            unchanged: 0,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { container, onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/JSON exports include password hashes, not plaintext passwords\./),
    ).toBeInTheDocument();

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const fileContents = JSON.stringify({
      accounts: [
        {
          email: "new.user@tavi.local",
          name: "New User",
          password: "new-password-123",
          role: "editor",
        },
      ],
    });
    const importFile = new File(["placeholder"], "local-accounts.json", {
      type: "application/json",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(async () => fileContents),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/import",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("new.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Imported 1 local account (1 created, 0 updated, 0 unchanged).",
    );
  });

  it("imports local accounts from CSV for admins", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
      ],
    };
    const confirmMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/import") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            accounts: [
              {
                email: "new.user@tavi.local",
                name: "New, User",
                password: 'new-"password"',
                role: "editor",
              },
            ],
          }),
        );

        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "user-2",
              "new.user@tavi.local",
              "New, User",
              "editor",
            ),
          ],
        };

        return createResponse({
          accounts: listResponse.accounts,
          summary: {
            processed: 1,
            created: 1,
            updated: 0,
            unchanged: 0,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    const { container, onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const importFile = new File(["placeholder"], "local-accounts.csv", {
      type: "text/csv",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(
        async () =>
          'name,email,role,password\n"New, User",new.user@tavi.local,editor,"new-""password"""\n',
      ),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/import",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    expect(confirmMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("new.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Imported 1 local account (1 created, 0 updated, 0 unchanged).",
    );
  });

  it("shows malformed CSV import errors without sending account changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse({
          accounts: [
            createAccountRecord(
              "user-1",
              "admin@tavi.local",
              "Admin",
              "admin",
            ),
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const importFile = new File(["placeholder"], "local-accounts.csv", {
      type: "text/csv",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(
        async () =>
          'name,email,role,password\n"New User,new.user@tavi.local,editor,new-password-123',
      ),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("CSV file contains an unterminated quoted value."),
      ).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url = typeof input === "string" ? input : input.toString();
        return url.endsWith("/auth/accounts/import") && init?.method === "POST";
      }),
    ).toBe(false);
  });

  it("asks whether duplicate imported emails should overwrite existing accounts", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "editor@tavi.local", "Editor", "editor"),
      ],
    };
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/import") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            accounts: [
              {
                email: "editor@tavi.local",
                name: "Editor Final",
                password: "",
                role: "admin",
              },
            ],
          }),
        );

        listResponse = {
          accounts: [
            createAccountRecord("user-1", "editor@tavi.local", "Editor Final", "admin"),
          ],
        };

        return createResponse({
          accounts: listResponse.accounts,
          summary: {
            processed: 1,
            created: 0,
            updated: 1,
            unchanged: 0,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    const { container, onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const importFile = new File(["placeholder"], "local-accounts.json", {
      type: "application/json",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(async () =>
        JSON.stringify({
          accounts: [
            {
              email: "editor@tavi.local",
              name: "Editor First",
              password: "",
              role: "viewer",
            },
            {
              email: "editor@tavi.local",
              name: "Editor Final",
              password: "",
              role: "admin",
            },
          ],
        }),
      ),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "1 email already in Tavi and 1 duplicate email inside the import file.",
        ),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/import",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Editor Final")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Imported 1 local account (0 created, 1 updated, 0 unchanged).",
    );
  });

  it("can skip duplicate imported emails and keep only unique new accounts", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "editor@tavi.local", "Editor", "editor"),
      ],
    };
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/import") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            accounts: [
              {
                email: "new.user@tavi.local",
                name: "New User First",
                password: "new-password-123",
                role: "viewer",
              },
            ],
          }),
        );

        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "user-2",
              "new.user@tavi.local",
              "New User First",
              "viewer",
            ),
          ],
        };

        return createResponse({
          accounts: listResponse.accounts,
          summary: {
            processed: 1,
            created: 1,
            updated: 0,
            unchanged: 0,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    const { container, onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const importFile = new File(["placeholder"], "local-accounts.json", {
      type: "application/json",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(async () =>
        JSON.stringify({
          accounts: [
            {
              email: "editor@tavi.local",
              name: "Editor Imported",
              password: "",
              role: "admin",
            },
            {
              email: "new.user@tavi.local",
              name: "New User First",
              password: "new-password-123",
              role: "viewer",
            },
            {
              email: "new.user@tavi.local",
              name: "New User Final",
              password: "new-password-456",
              role: "editor",
            },
          ],
        }),
      ),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(confirmMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          "1 email already in Tavi and 1 duplicate email inside the import file.",
        ),
      );
      expect(confirmMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("Select OK to skip duplicate emails"),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/import",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("new.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Imported 1 local account (1 created, 0 updated, 0 unchanged).",
    );
  });

  it("bulk changes the role for selected local accounts", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "viewer.one@tavi.local",
          "Viewer One",
          "viewer",
        ),
        createAccountRecord(
          "user-3",
          "viewer.two@tavi.local",
          "Viewer Two",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/user-2") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ role: "editor" }));
        listResponse = {
          accounts: [
            listResponse.accounts[0],
            createAccountRecord(
              "user-2",
              "viewer.one@tavi.local",
              "Viewer One",
              "editor",
            ),
            listResponse.accounts[2],
          ],
        };

        return createResponse({ account: listResponse.accounts[1] });
      }

      if (url.endsWith("/auth/accounts/user-3") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ role: "editor" }));
        listResponse = {
          accounts: [
            listResponse.accounts[0],
            listResponse.accounts[1],
            createAccountRecord(
              "user-3",
              "viewer.two@tavi.local",
              "Viewer Two",
              "editor",
            ),
          ],
        };

        return createResponse({ account: listResponse.accounts[2] });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer.two@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select local account Viewer One"));
    fireEvent.click(screen.getByLabelText("Select local account Viewer Two"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk Change Role" }));
    fireEvent.change(screen.getByDisplayValue("Viewer"), {
      target: { value: "editor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-3",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Changed role to editor for 2 local accounts.",
    );
  });

  it("bulk resets passwords for selected local accounts", async () => {
    const listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "viewer.one@tavi.local",
          "Viewer One",
          "viewer",
        ),
        createAccountRecord(
          "user-3",
          "viewer.two@tavi.local",
          "Viewer Two",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (
        (url.endsWith("/auth/accounts/user-2/password") ||
          url.endsWith("/auth/accounts/user-3/password")) &&
        init?.method === "POST"
      ) {
        expect(init.body).toBe(JSON.stringify({ password: "bulk-password-123" }));
        return createResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer.two@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select local account Viewer One"));
    fireEvent.click(screen.getByLabelText("Select local account Viewer Two"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk Password Reset" }));
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "bulk-password-123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "bulk-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2/password",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-3/password",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Set a shared password for 2 local accounts.",
    );
  });

  it("bulk deletes selected local accounts", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("admin-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord(
          "user-2",
          "viewer.one@tavi.local",
          "Viewer One",
          "viewer",
        ),
        createAccountRecord(
          "user-3",
          "viewer.two@tavi.local",
          "Viewer Two",
          "viewer",
        ),
      ],
    };
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/user-2") && init?.method === "DELETE") {
        listResponse = {
          accounts: [listResponse.accounts[0], listResponse.accounts[2]],
        };
        return createResponse({ id: "user-2" });
      }

      if (url.endsWith("/auth/accounts/user-3") && init?.method === "DELETE") {
        listResponse = {
          accounts: [listResponse.accounts[0]],
        };
        return createResponse({ id: "user-3" });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer.two@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select local account Viewer One"));
    fireEvent.click(screen.getByLabelText("Select local account Viewer Two"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk Delete" }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        "Remove 2 local accounts? Accounts with blockers stay selected and will report an error.",
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-2",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/user-3",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("viewer.one@tavi.local")).not.toBeInTheDocument();
      expect(screen.queryByText("viewer.two@tavi.local")).not.toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith("Removed 2 local accounts.");
  });

  it("resets the default local accounts for admins", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord(
          "user-9",
          "other.user@tavi.local",
          "Other User",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/reset-defaults") && init?.method === "POST") {
        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "admin-1",
              "admin@tavi.local",
              "Tavi Admin",
              "admin",
            ),
            createAccountRecord(
              "editor-1",
              "editor@tavi.local",
              "Tavi Editor",
              "editor",
            ),
            createAccountRecord(
              "viewer-1",
              "viewer@tavi.local",
              "Tavi Viewer",
              "viewer",
            ),
          ],
        };

        return createResponse(listResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("other.user@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore Defaults" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/reset-defaults",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Restored admin@tavi.local, editor@tavi.local, and viewer@tavi.local to password123 and re-enabled the login hint.",
    );
  });

  it("clears all local accounts except the current user and guest after password confirmation", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
        createAccountRecord("user-2", "guest@tavi.local", "Guest", "viewer"),
        createAccountRecord("user-3", "editor.one@tavi.local", "Editor One", "editor"),
        createAccountRecord("user-4", "viewer.one@tavi.local", "Viewer One", "viewer"),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/clear-all") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ currentPassword: "currentpassword123" }));
        listResponse = {
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
            createAccountRecord("user-2", "guest@tavi.local", "Guest", "viewer"),
          ],
        };

        return createResponse({ deletedCount: 2 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("editor.one@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer.one@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all local accounts" }));
    fireEvent.change(screen.getByPlaceholderText("Current admin password"), {
      target: { value: "currentpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear Accounts" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/clear-all",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            currentPassword: "currentpassword123",
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("editor.one@tavi.local")).not.toBeInTheDocument();
      expect(screen.queryByText("viewer.one@tavi.local")).not.toBeInTheDocument();
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("guest@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Cleared 2 local accounts. Kept your account and guest.",
    );
  });
});
