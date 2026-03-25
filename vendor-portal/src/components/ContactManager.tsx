import React from "react";
import { Card, CardBody, CardHeader } from "./Card";
import { Button } from "./Button";

export function ContactManager() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Contact Management</h3>
            <p className="text-sm text-gray-500">Add, import, and message vendors</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary">Import CSV</Button>
            <Button variant="primary">Add Contact</Button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div className="text-sm text-gray-600">
          No contacts yet. Next step: we’ll wire this to your Organizer Contacts page + the Figma layout.
        </div>
      </CardBody>
    </Card>
  );
}





