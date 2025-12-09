# PetriNetBuilder

PetriNetBuilder is a browser-based tool for creating, simulating, and analysing Place/Transition Petri Nets.  
This project was developed as part of a bachelor’s thesis at the Faculty of Informatics, Technical University of Vienna.
For inquiries please contact: handas705@gmail.com
---

## Features

- **Web-based editor**
  - Create places, transitions, and arcs on an interactive canvas  
  - Edit labels, arc weights, and initial markings  

- **Simulation**
  - Step-by-step/automatic firing of enabled transitions  
  - History / trace view of executed transitions and markings

- **Import / Export**
  - Import and export Petri nets in **PNML** (Petri Net Markup Language)  
  - Export diagrams as **LaTeX/TikZ** for use in scientific documents

- **Analysis (basic)**
  - Deadlock detection  
  - Simple \(k\)-boundedness checks

---

## Web-Application

PetriNetBuilder can be accessed via browser:

- **Live demo:** `https://hannes307.github.io/PetriNetSimulator/`

---

## Repository

The full source code can be found under:

- 📦 **Source code:** `https://github.com/hannes307/PetriNetSimulator`

---

## Building and Running Locally

> The exact steps here depend on your tech stack.  
> Replace the placeholder commands with your actual ones.

```bash
# Clone the repository
git clone https://github.com/hannes307/PetriNetSimulator.git
cd PetriNetSimulator

# Install dependencies
npm install   # or pnpm install / yarn

# Start development server
npm run dev

# Build for production
npm run build
